import assert from 'node:assert/strict';
import test from 'node:test';
import { callKimiJson, callKimiStream, ModelOutputError, type KimiOptions, type Message } from '../src/lib/kimi';
import { HttpError } from '../src/lib/http';
import { modelDeltas } from '../src/lib/model-stream';

const messages: Message[] = [{ role: 'user', content: 'Explain the supplied study excerpt.' }];

test('Kimi requests use model-appropriate bounded token settings and sanitized failures', async t => {
  process.env.KIMI_API_KEY = 'mock-provider-key';
  process.env.KIMI_BASE_URL = 'http://localhost/mock-provider';
  process.env.KIMI_MODEL = 'kimi-k3';
  const requests: Array<Record<string, unknown>> = [];
  let status = 200;
  let truncated = false;
  let cancellationCount = 0;
  const errorLog = t.mock.method(console, 'error', () => undefined);
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(payload);
    if (status !== 200) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('private-provider-debug-body')); },
        cancel() { cancellationCount++; },
      }), { status });
    }
    if (payload.stream) return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    return Response.json({ choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: '[{"question":"Example"}]' } }] });
  });

  await t.test('K3 streaming has a finite completion budget and low reasoning effort', async () => {
    await (await callKimiStream(messages)).cancel();
    const payload = requests.at(-1)!;
    assert.equal(payload.model, 'kimi-k3');
    assert.equal(payload.max_completion_tokens, 8192);
    assert.equal(payload.reasoning_effort, 'low');
    assert.equal('max_tokens' in payload, false);
    assert.equal('temperature' in payload, false);
    assert.equal('thinking' in payload, false);
    assert.deepEqual(payload.messages, messages);
  });

  await t.test('K3 JSON generation has room for structured answers and preserves explicit smaller bounds', async () => {
    assert.deepEqual(await callKimiJson(messages), [{ question: 'Example' }]);
    assert.equal(requests.at(-1)!.max_completion_tokens, 12288);
    await callKimiJson(messages, { maxTokens: 2048 });
    assert.equal(requests.at(-1)!.max_completion_tokens, 2048);
    await callKimiJson(messages, { maxTokens: 12288 });
    assert.equal(requests.at(-1)!.max_completion_tokens, 12288);
    await callKimiJson(messages, { maxTokens: 50000 });
    assert.equal(requests.at(-1)!.max_completion_tokens, 16384);
  });

  await t.test('legacy Moonshot models retain max_tokens and a bounded caller budget', async () => {
    process.env.KIMI_MODEL = 'moonshot-v1-128k';
    await (await callKimiStream(messages)).cancel();
    assert.equal(requests.at(-1)!.max_tokens, 2200);
    await callKimiJson(messages);
    assert.equal(requests.at(-1)!.max_tokens, 12000);
    await callKimiJson(messages, { maxTokens: 8192 });
    assert.equal(requests.at(-1)!.max_tokens, 8192);
    await callKimiJson(messages, { maxTokens: 50000 });
    const payload = requests.at(-1)!;
    assert.equal(payload.max_tokens, 14000);
    assert.equal(payload.temperature, 1);
    assert.equal('max_completion_tokens' in payload, false);
    assert.equal('reasoning_effort' in payload, false);
    await callKimiJson(messages, { reasoningEffort: 'high' });
    assert.equal(requests.at(-1)!.max_tokens, 12000);
    assert.equal('reasoning_effort' in requests.at(-1)!, false);
    process.env.KIMI_MODEL = 'kimi-k3';
  });

  await t.test('high and max effort have finite larger budgets while preserving smaller caller limits', async () => {
    await (await callKimiStream(messages, { reasoningEffort: 'high' })).cancel();
    assert.equal(requests.at(-1)!.reasoning_effort, 'high');
    assert.equal(requests.at(-1)!.max_completion_tokens, 16384);
    await callKimiJson(messages, { reasoningEffort: 'high' });
    assert.equal(requests.at(-1)!.max_completion_tokens, 24576);
    await callKimiJson(messages, { reasoningEffort: 'high', maxTokens: 4096 });
    assert.equal(requests.at(-1)!.max_completion_tokens, 4096);
    for (const reasoningEffort of ['high', 'max'] as const) {
      await callKimiJson(messages, { reasoningEffort, maxTokens: 1000000 });
      const payload = requests.at(-1)!;
      assert.equal(payload.max_completion_tokens, 32768);
      assert.equal(payload.reasoning_effort, reasoningEffort);
      assert.equal('temperature' in payload, false);
      assert.equal('thinking' in payload, false);
    }
    await (await callKimiStream(messages, { reasoningEffort: 'max' })).cancel();
    assert.equal(requests.at(-1)!.max_completion_tokens, 32768);
    await callKimiJson(messages, { reasoningEffort: 'max' });
    assert.equal(requests.at(-1)!.max_completion_tokens, 32768);
  });

  await t.test('unsupported reasoning efforts never reach the provider', async () => {
    const before = requests.length;
    for (const reasoningEffort of ['medium', '', 'MAX', null, 3]) {
      await assert.rejects(callKimiJson(messages, { reasoningEffort } as KimiOptions), error => error instanceof HttpError && error.status === 400);
    }
    assert.equal(requests.length, before);
  });

  await t.test('request timeouts scale with effort and remain bounded', async t => {
    const timeouts: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (duration: number) => { timeouts.push(duration); return new AbortController().signal; });
    for (const reasoningEffort of ['low', 'high', 'max'] as const) await callKimiJson(messages, { reasoningEffort });
    assert.deepEqual(timeouts, [120000, 240000, 270000]);
    process.env.KIMI_MODEL = 'moonshot-v1-128k';
    try {
      await callKimiJson(messages, { reasoningEffort: 'max' });
      assert.equal(timeouts.at(-1), 120000);
    } finally { process.env.KIMI_MODEL = 'kimi-k3'; }
  });

  await t.test('already canceled requests make no provider call', async () => {
    const before = requests.length;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(callKimiJson(messages, { signal: controller.signal, reasoningEffort: 'high' }), error => error instanceof HttpError && error.status === 499);
    assert.equal(requests.length, before);
  });

  await t.test('timeout and caller cancellation while reading JSON do not become repairable model failures', async t => {
    for (const callerCanceled of [false, true]) {
      const timeout = new AbortController();
      const caller = new AbortController();
      const timeoutMock = t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
      const fetchMock = t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(new Error('private-provider-abort-detail')), { once: true });
          queueMicrotask(() => (callerCanceled ? caller : timeout).abort());
        } }));
      });
      try {
        await assert.rejects(callKimiJson(messages, { signal: caller.signal, reasoningEffort: 'high' }), error => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.status, callerCanceled ? 499 : 504);
          assert.equal(error instanceof ModelOutputError, false);
          assert.doesNotMatch(error.message, /private-provider-abort-detail/);
          return true;
        });
      } finally { fetchMock.mock.restore(); timeoutMock.mock.restore(); }
    }
  });

  await t.test('higher effort returns only the final answer, never provider reasoning content', async t => {
    t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (!payload.stream) return Response.json({ choices: [{ message: { content: '{"answer":"Final answer"}', reasoning_content: 'private-reasoning-content' } }] });
      return new Response('data: {"choices":[{"delta":{"reasoning_content":"private-reasoning-content"}}]}\n\ndata: {"choices":[{"delta":{"content":"Final answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    assert.deepEqual(await callKimiJson(messages, { reasoningEffort: 'high' }), { answer: 'Final answer' });
    let answer = '';
    for await (const delta of modelDeltas(await callKimiStream(messages, { reasoningEffort: 'high' }))) answer += delta;
    assert.equal(answer, 'Final answer');
  });

  await t.test('invalid caller budgets never reach the provider', async () => {
    const before = requests.length;
    for (const maxTokens of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(callKimiJson(messages, { maxTokens }), error => error instanceof HttpError && error.status === 400);
    }
    assert.equal(requests.length, before);
  });

  await t.test('truncated JSON output remains invalid instead of being accepted as a complete exam', async () => {
    truncated = true;
    try { await assert.rejects(callKimiJson(messages), ModelOutputError); }
    finally { truncated = false; }
  });

  await t.test('provider HTTP failures never expose or log their raw response body', async () => {
    for (const code of [400, 401, 403, 429, 500, 503]) {
      status = code;
      await assert.rejects(callKimiJson(messages), error => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, code === 429 ? 429 : 502);
        assert.doesNotMatch(error.message, /private-provider-debug-body|mock-provider-key/);
        return true;
      });
    }
    assert.equal(cancellationCount, 6);
    assert.equal(errorLog.mock.callCount(), 0);
    status = 200;
  });
});
