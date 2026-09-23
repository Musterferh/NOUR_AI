import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { apiError, HttpError, readJson } from '@/lib/http';
import { acquireLease, enforceQuota } from '@/lib/security';
import { callKimiStream, type Message } from '@/lib/kimi';
import { retrieveContext, retrieveContextForTopics } from '@/lib/pdf-pipeline';
import { prisma } from '@/lib/prisma';
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from '@/lib/config';
import { boundHistory, buildCoachMessages, wantsPersonalRevision } from '@/lib/coaching';
import { buildProgress } from '@/lib/exams';
import { modelDeltas } from '@/lib/model-stream';
import type { SourceReference } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 180;
const inputSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH), sessionId: z.string().min(1).max(100), turnId: z.string().uuid() }).strict();
const encoder = new TextEncoder();
function event(data: unknown) { return encoder.encode(`data: ${JSON.stringify(data)}\n\n`); }
const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };

export async function POST(req: Request) {
  let release: (() => Promise<void>) | undefined;
  let assistantId: string | undefined;
  try {
    const ownerId = await requireOwner(req);
    const { message, sessionId, turnId } = await readJson(req, inputSchema, 40_000);
    const session = await prisma.session.findFirst({ where: { id: sessionId, ownerId } });
    if (!session) throw new HttpError(404, 'Session not found.');
    release = await acquireLease(`chat:${sessionId}`, 175_000);
    const previous = await prisma.message.findMany({ where: { sessionId, turnId } });
    const user = previous.find(item => item.role === 'user');
    const assistant = previous.find(item => item.role === 'assistant');
    if (user && user.content !== message) throw new HttpError(409, 'This turn ID was already used for another message.');
    if (assistant?.status === 'complete') {
      await release(); release = undefined;
      const replay = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(event({ type: 'sources', sources: JSON.parse(assistant.sources) }));
        controller.enqueue(event({ choices: [{ delta: { content: assistant.content } }] }));
        controller.enqueue(event({ type: 'done', messageId: assistant.id }));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } });
      return new Response(replay, { headers });
    }
    await enforceQuota(ownerId, 'chat');
    // Legacy messages have null turn IDs; SQL NOT excludes nulls unless they are included explicitly.
    const rows = await prisma.message.findMany({ where: { sessionId, status: 'complete', OR: [{ turnId: null }, { turnId: { not: turnId } }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MAX_HISTORY_MESSAGES });
    rows.reverse();
    const history = boundHistory(rows.filter(item => item.role === 'user' || item.role === 'assistant').map(item => ({ role: item.role as Message['role'], content: item.content })));
    const lastAssistant = rows.findLast(item => item.role === 'assistant');
    const retainedSources: SourceReference[] = lastAssistant ? JSON.parse(lastAssistant.sources) : [];
    const attempts = await prisma.examAttempt.findMany({ where: { ownerId, submittedAt: { not: null } }, orderBy: { startedAt: 'desc' }, take: 30 });
    const progress = buildProgress(attempts);
    const revision = wantsPersonalRevision(message);
    const retrievalRequest = { query: message, category: session.category, history, sourceIds: retainedSources.map(source => source.id), maxChunks: 6 };
    const retrieval = revision && progress.recommendedTopics.length
      ? await retrieveContextForTopics(retrievalRequest, progress.recommendedTopics.slice(0, 3))
      : await retrieveContext(retrievalRequest);
    const sources = retrieval.sources;
    const stored = await prisma.$transaction(async tx => {
      if (!user) await tx.message.create({ data: { sessionId, turnId, role: 'user', content: message, createdAt: new Date() } });
      const data = { content: '', status: 'pending', sources: JSON.stringify(sources) };
      const result = assistant
        ? await tx.message.update({ where: { id: assistant.id }, data })
        : await tx.message.create({ data: { ...data, sessionId, turnId, role: 'assistant', createdAt: new Date(Date.now() + 1) } });
      await tx.session.update({ where: { id: sessionId }, data: { updatedAt: new Date(), ...(session.title === 'New Chat' ? { title: message.slice(0, 70) } : {}) } });
      return result;
    });
    assistantId = stored.id;
    const messages = buildCoachMessages({ category: session.category, mode: session.mode, context: retrieval.context, sources, history, message, learningRecord: { completedExams: attempts.length, weakTopics: progress.weakTopics.slice(0, 8), recentMistakes: progress.mistakes.slice(0, 5), target: 90 } });
    const stop = new AbortController();
    const signal = AbortSignal.any([req.signal, stop.signal, AbortSignal.timeout(150_000)]);
    const upstream = await callKimiStream(messages, { signal });
    let canceled = false;
    const finishLease = release;
    release = undefined; // Stream owns cleanup after this point.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let content = '';
        let status = 'complete';
        let errorSent = false;
        let lastSaved = Date.now();
        const send = (value: unknown, allowAfterAbort = false) => { if (!canceled && (!signal.aborted || allowAfterAbort)) controller.enqueue(event(value)); };
        const fail = (message: string) => { errorSent = true; send({ type: 'error', message }, true); };
        try {
          send({ type: 'sources', sources });
          for await (const delta of modelDeltas(upstream)) {
            if (signal.aborted) throw new HttpError(499, 'The response was stopped.');
            content += delta;
            if (content.length > 24_000) { stop.abort(); throw new HttpError(502, 'The response was too long. Please ask a narrower question.'); }
            send({ choices: [{ delta: { content: delta } }] });
            if (Date.now() - lastSaved > 1500) {
              await prisma.message.updateMany({ where: { id: stored.id }, data: { content } });
              lastSaved = Date.now();
            }
          }
          if (!content.trim()) throw new HttpError(502, 'The coach returned an empty response. Please retry.');
          const citations = [...content.matchAll(/\[source:([a-zA-Z0-9_-]+)\]/g)].map(match => match[1]);
          if (citations.length > 0 && citations.some(id => !sources.some(source => source.id === id))) {
            const note = '\n\n**Source check:** This response cited a source reference that was not provided in the current context. Review the attached excerpts before relying on its factual claims.';
            content += note;
            send({ choices: [{ delta: { content: note } }] });
          }
        } catch (error) {
          status = signal.aborted || canceled ? 'stopped' : 'failed';
          fail(error instanceof HttpError ? error.message : 'The response was interrupted. You can retry this turn.');
        } finally {
          if (signal.aborted || canceled) status = 'stopped';
          if (status === 'stopped' && !errorSent) fail('The response was stopped. You can retry this turn.');
          try {
            await prisma.message.updateMany({ where: { id: stored.id }, data: { content, status } });
            await prisma.session.updateMany({ where: { id: sessionId, ownerId }, data: { updatedAt: new Date() } });
            if (status === 'complete') send({ type: 'done', messageId: stored.id });
          } catch { status = 'failed'; fail('Your response could not be saved. Please reload before continuing.'); }
          await finishLease?.().catch(() => console.error('Chat lease cleanup failed.'));
          if (!canceled) {
            if (status === 'complete') controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }
      },
      cancel() { canceled = true; stop.abort(); },
    });
    return new Response(stream, { headers });
  } catch (error) {
    if (assistantId) await prisma.message.updateMany({ where: { id: assistantId }, data: { status: req.signal.aborted ? 'stopped' : 'failed' } }).catch(() => undefined);
    return apiError(error);
  } finally { if (release) await release().catch(() => console.error('Chat lease cleanup failed.')); }
}
