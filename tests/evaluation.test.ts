import test from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_CASES } from '../scripts/evaluate-conversation';
import { checkAnswer, parseEvaluationArguments, referenceIsAvailable, renderEvaluationMarkdown, runConversationEvaluation, sanitizeEvaluationValue, type ConversationCase, type EvaluationDependencies, type EvaluationTurn, type ReferenceFixture } from '../src/lib/evaluation';
import { KIMI_REASONING_LIMITS } from '../src/lib/kimi';
import type { Chunk, RetrievalRequest, SourceReference } from '../src/types';

const source: SourceReference = { id: 'reviewed-1', title: 'Reviewed fixture', status: 'VERIFY', excerpt: 'The fixture states twelve months.' };
const turn = (id = 'first'): EvaluationTurn => ({ id, prompt: `Question ${id}`, checks: [], manualReview: ['Inspect the actual meaning.'], planningReply: 'Simulated retrieval-plan answer.' });
const scenario = (id = 'case', turns = [turn()]): ConversationCase => ({ id, description: 'Synthetic test', category: 'General', mode: 'MODE 1 — TEACH', references: [], turns });
const options = (args: string[] = []) => parseEvaluationArguments(['--live', ...args]);
function streamText(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
    controller.close();
  } });
}
function answerStream(answer = 'Public answer [source:reviewed-1]', hidden = 'PRIVATE THOUGHTS MUST NOT BE SAVED') {
  return streamText([
    { choices: [{ delta: { reasoning_content: hidden } }] },
    { choices: [{ delta: { content: answer }, finish_reason: 'stop' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
}
function dependencies(overrides: Partial<EvaluationDependencies> = {}): EvaluationDependencies {
  return {
    retrieve: async () => ({ context: source.excerpt, sources: [source], quality: 'matched' }),
    stream: async () => answerStream(),
    decideReasoning: () => ({ effort: 'low', reasons: ['routine'] }),
    findReference: () => undefined,
    ...overrides,
  };
}

test('CLI defaults to no paid calls and rejects unbounded or ambiguous arguments', () => {
  assert.equal(parseEvaluationArguments([]).live, false);
  assert.equal(options().maxRequests, 10);
  assert.equal(options().maxTokens, 16_384);
  for (const args of [['--live', '--dry-run'], ['--max-requests', '13'], ['--max-tokens', '16385'], ['--timeout-ms', '0'], ['--max-total-tokens', '1e9'], ['--output'], ['--unknown'], ['--live', '--live']]) {
    assert.throws(() => parseEvaluationArguments(args));
  }
  assert.deepEqual(parseEvaluationArguments(['--case', 'one', '--case', 'two']).caseIds, ['one', 'two']);
});

test('dry-run performs retrieval with explicitly simulated history and never opens provider stream', async () => {
  const requests: RetrievalRequest[] = [];
  const report = await runConversationEvaluation([scenario('case', [turn(), turn('follow-up')])], parseEvaluationArguments([]), dependencies({
    retrieve: async request => { requests.push(request); return { context: source.excerpt, sources: [source], quality: 'matched' }; },
    stream: async () => { throw new Error('A dry-run must never call the provider'); },
  }));
  assert.equal(report.counters.requests, 0);
  assert.equal(report.counters.failedTurns, 0);
  assert.equal(report.cases[0].turns[1].answer, null);
  assert.equal(requests[1].history?.[1].content, turn().planningReply);
  assert.deepEqual(requests[1].sourceIds, ['reviewed-1']);
  assert.match(report.caveat, /history is simulated/);
});

test('live mock uses the real SSE parser, preserves public history and sources, and discards private reasoning', async () => {
  const requests: RetrievalRequest[] = [];
  const providerPrompts: string[][] = [];
  const progress: string[] = [];
  const report = await runConversationEvaluation([scenario('case', [turn(), turn('follow-up')])], options(), dependencies({
    retrieve: async request => { requests.push(request); return { context: source.excerpt, sources: [source], quality: 'matched' }; },
    stream: async messages => { providerPrompts.push(messages.map(message => message.content)); return answerStream('Twelve months — ƙwarai [source:reviewed-1]'); },
    onProgress: event => progress.push(event.phase),
  }));
  assert.equal(report.counters.requests, 2);
  assert.equal(report.counters.completedTurns, 2);
  assert.deepEqual(requests[1].sourceIds, ['reviewed-1']);
  assert.equal(requests[1].history?.[1].content, report.cases[0].turns[0].answer);
  assert.ok(providerPrompts[1].includes('Twelve months — ƙwarai [source:reviewed-1]'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE THOUGHTS'));
  assert.ok(!renderEvaluationMarkdown(report).includes('PRIVATE THOUGHTS'));
  assert.deepEqual(progress, ['starting', 'finished', 'starting', 'finished']);
  assert.ok(report.cases[0].turns[0].firstTokenMs !== undefined);
});

test('default reasoning budgets match production and a requested lower ceiling remains binding', async () => {
  const budgets: number[] = [];
  const report = await runConversationEvaluation([scenario('case', [turn('low'), turn('high')])], options(), dependencies({
    decideReasoning: message => ({ effort: message.endsWith('high') ? 'high' : 'low', reasons: ['routine'] }),
    stream: async (_messages, settings) => { budgets.push(settings.maxTokens); return answerStream(); },
  }));
  assert.deepEqual(budgets, [KIMI_REASONING_LIMITS.low.streamTokens, KIMI_REASONING_LIMITS.high.streamTokens]);
  assert.equal(report.counters.reservedCompletionTokens, 24_576);
  assert.deepEqual(report.cases[0].turns.map(item => item.requestTimeoutMs), [120_000, 240_000]);
  const capped = await runConversationEvaluation([scenario()], options(['--max-tokens', '1000']), dependencies());
  assert.equal(capped.cases[0].turns[0].completionTokenCap, 1000);
});

test('request, completion reservation and input limits stop before another paid call', async () => {
  for (const [args, expectedRequests] of [
    [['--max-requests', '1'], 1],
    [['--max-total-tokens', '8192'], 1],
    [['--max-input-characters', '1'], 0],
    [['--max-total-input-characters', '1'], 0],
  ] as const) {
    let calls = 0;
    const report = await runConversationEvaluation([scenario('case', [turn(), turn('second')])], options([...args]), dependencies({ stream: async () => { calls++; return answerStream(); } }));
    assert.equal(calls, expectedRequests);
    assert.ok(report.counters.skippedTurns > 0);
    assert.match(report.cases[0].turns.at(-1)?.error ?? '', /cap reached|exceeds.*cap/i);
  }
  await assert.rejects(runConversationEvaluation([scenario()], { ...options(), maxRequests: 99 }, dependencies()), /bounds/);
});

test('cancellation and elapsed budget prevent requests before they are opened', async () => {
  const cancel = new AbortController(); cancel.abort();
  const report = await runConversationEvaluation([scenario()], options(), dependencies({ signal: cancel.signal, stream: async () => { throw new Error('must not be called'); } }));
  assert.equal(report.counters.requests, 0);
  assert.match(report.cases[0].turns[0].error ?? '', /canceled/);
  let clock = 0;
  const expired = await runConversationEvaluation([scenario()], options(['--max-duration-ms', '10']), dependencies({ now: () => { clock += 100; return clock; } }));
  assert.equal(expired.counters.requests, 0);
  assert.match(expired.cases[0].turns[0].error ?? '', /elapsed-time cap/);
});

test('truncated streams retain partial public answers, skip dependent turns, and never retry', async () => {
  let calls = 0;
  const report = await runConversationEvaluation([
    scenario('first', [turn(), turn('dependent')]), scenario('second'), scenario('third'),
  ], options(), dependencies({ stream: async () => { calls++; return streamText('data: {"choices":[{"delta":{"content":"Partial public answer"}}]}\n\n'); } }));
  assert.equal(calls, 2);
  assert.equal(report.counters.failedTurns, 2);
  assert.equal(report.counters.skippedTurns, 2);
  assert.equal(report.cases[0].turns[0].answer, 'Partial public answer');
  assert.equal(report.cases[0].turns[1].status, 'skipped');
  assert.match(report.cases[2].turns[0].error ?? '', /two consecutive provider failures/);
});

test('reference hashes and expected passage must match before a case can spend requests', async () => {
  const fixture: ReferenceFixture = { id: 'ref', hashKind: 'source-file', sha256: 'expected-hash', passagePattern: 'twelve months', expectedFact: 'Twelve months.' };
  const chunk: Chunk = { id: 'ref', content: 'twelve months', metadata: { id: 'ref', chapter: '', topic: '', statusTag: 'VERIFY', sourceHash: 'changed-hash' } };
  assert.equal(referenceIsAvailable(fixture, chunk), false);
  const oneCase = scenario(); oneCase.references = [fixture];
  const report = await runConversationEvaluation([oneCase], options(), dependencies({ findReference: () => chunk }));
  assert.equal(report.counters.requests, 0);
  assert.equal(report.counters.skippedTurns, 1);
  chunk.metadata.sourceHash = 'expected-hash';
  assert.equal(referenceIsAvailable(fixture, chunk), true);
  chunk.content = 'six months';
  assert.equal(referenceIsAvailable(fixture, chunk), false);
});

test('citation checks reject invented references and require the specifically reviewed evidence', () => {
  const question = { ...turn(), requireCitation: true, expectedSourceIds: ['reviewed-1'] };
  const results = checkAnswer(question, 'Twelve months [source:invented]', [source]);
  assert.equal(results.find(item => item.id === 'citation-membership')?.passed, false);
  assert.equal(results.find(item => item.id === 'reviewed-source-cited')?.passed, false);
  assert.ok(checkAnswer(question, 'Twelve months [source:reviewed-1]', [source]).every(item => item.passed));
});

test('citation checks accept optional whitespace without accepting unknown references', () => {
  const question = { ...turn(), requireCitation: true, expectedSourceIds: ['reviewed-1'] };
  for (const citation of ['[source: reviewed-1]', '[source:reviewed-1 ]', '[source: reviewed-1 ]']) {
    assert.ok(checkAnswer(question, `Twelve months ${citation}`, [source]).every(item => item.passed));
  }
  assert.equal(checkAnswer(question, 'Twelve months [source: invented ]', [source]).find(item => item.id === 'citation-membership')?.passed, false);
});

test('dry-run reports empty expected evidence even when the provider is never called', async () => {
  const question = { ...turn(), expectedSourceIds: ['reviewed-1'] };
  const report = await runConversationEvaluation([scenario('missing', [question])], parseEvaluationArguments([]), dependencies({
    retrieve: async () => ({ context: '', sources: [], quality: 'none' }),
    stream: async () => { throw new Error('Must not spend on a dry-run'); },
  }));
  assert.equal(report.counters.requests, 0);
  assert.equal(report.counters.failedChecks, 1);
  assert.equal(report.cases[0].turns[0].checks[0].id, 'reviewed-source-retrieved');
});

test('report sanitization scrubs nested known credentials and common credential formats', () => {
  const sanitized = sanitizeEvaluationValue({ answer: 'key=super-secret-value', error: 'Bearer abcd1234 sk-1234567890abcdef', sources: [{ url: 'https://user:password@example.test/a' }] }, ['super-secret-value']);
  const output = JSON.stringify(sanitized);
  for (const secret of ['super-secret-value', 'abcd1234', 'sk-1234567890abcdef', 'user:password']) assert.ok(!output.includes(secret));
  assert.ok(output.includes('[REDACTED]'));
});

test('the fixed suite contains ten calls, checked primary sources, contextual follow-ups and a numerical topic switch', () => {
  assert.equal(CONVERSATION_CASES.reduce((count, item) => count + item.turns.length, 0), 10);
  const primary = CONVERSATION_CASES.flatMap(item => item.references).filter(item => item.hashKind === 'checked-excerpt');
  assert.deepEqual(primary.map(item => item.id), ['primary-itu-spectrum-2015', 'primary-itu-qos-qoe-2019']);
  for (const fixture of primary) assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
  const turns = CONVERSATION_CASES.flatMap(item => item.turns);
  assert.ok(turns.some(item => item.prompt === 'B'));
  assert.ok(turns.some(item => item.prompt === 'Why?'));
  assert.ok(turns.some(item => item.category === 'General' && /240/.test(item.prompt)));
  for (const item of CONVERSATION_CASES.filter(item => item.references.some(reference => reference.hashKind === 'source-file'))) {
    for (const question of item.turns) assert.ok(question.expectedSourceIds?.length, `${item.id}/${question.id} must check expected retrieval in dry-run`);
  }
});
