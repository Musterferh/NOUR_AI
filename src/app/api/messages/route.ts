import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { apiError, HttpError, json } from '@/lib/http';

export async function GET(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const params = new URL(req.url).searchParams;
    const sessionId = params.get('sessionId');
    if (!sessionId || !await prisma.session.findFirst({ where: { id: sessionId, ownerId } })) throw new HttpError(404, 'Session not found.');
    await prisma.$transaction(async tx => {
      const running = await tx.requestLease.findFirst({ where: { id: `chat:${sessionId}`, expiresAt: { gt: new Date() } } });
      if (!running) {
        // A host restart may bypass a stream's finally block. Once its lease has
        // expired, the saved partial response is explicitly retriable.
        await tx.message.updateMany({ where: { sessionId, role: 'assistant', status: 'pending' }, data: { status: 'stopped' } });
      }
    });
    const cursor = params.get('cursor');
    if (cursor && !await prisma.message.findFirst({ where: { id: cursor, sessionId } })) throw new HttpError(400, 'Invalid message cursor.');
    const messages = await prisma.message.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const response = json(messages.reverse().map(message => ({ ...message, sources: JSON.parse(message.sources) })));
    if (messages.length === 100) response.headers.set('X-Next-Cursor', messages[0].id);
    return response;
  } catch (error) { return apiError(error); }
}
