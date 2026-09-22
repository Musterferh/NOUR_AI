import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDeltas } from '../src/lib/model-stream';
import { HttpError, readJson } from '../src/lib/http';
import { z } from 'zod';

function streamText(text: string, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
    controller.close();
  } });
}
async function collect(stream: ReadableStream<Uint8Array>) {
  let value = '';
  for await (const delta of modelDeltas(stream)) value += delta;
  return value;
}

test('provider SSE preserves fragmented JSON, CRLF and multibyte text', async () => {
  const text = `: heartbeat\r\n\r\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'Sannu — ƙwarai!' } }] })}\r\n\r\ndata: [DONE]\r\n\r\n`;
  assert.equal(await collect(streamText(text)), 'Sannu — ƙwarai!');
});
test('provider SSE accepts final event without trailing newline', async () => {
  assert.equal(await collect(streamText('data: {"choices":[{"delta":{"content":"Ready"},"finish_reason":"stop"}]}', 7)), 'Ready');
});
test('provider SSE rejects silent truncation and malformed payloads', async () => {
  await assert.rejects(collect(streamText('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n')), /ended early/);
  await assert.rejects(collect(streamText('data: not json\n\n')), /interrupted/);
  await assert.rejects(collect(streamText('data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')), /length limit/);
});
test('provider errors never leak their body to the caller', async () => {
  await assert.rejects(collect(streamText('data: {"error":{"message":"provider-secret-body"}}\n\n')), error => error instanceof HttpError && !error.message.includes('provider-secret-body'));
});
test('JSON validation bounds streamed bodies even without Content-Length', async () => {
  const request = new Request('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: streamText('{"text":"too long"}'), duplex: 'half' } as RequestInit & { duplex: string });
  await assert.rejects(readJson(request, z.object({ text: z.string() }), 10), error => error instanceof HttpError && error.status === 413);
});
test('JSON validation distinguishes malformed JSON and wrong media types', async () => {
  await assert.rejects(readJson(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), z.object({})), error => error instanceof HttpError && error.status === 400);
  await assert.rejects(readJson(new Request('http://localhost', { method: 'POST', body: '{}' }), z.object({})), error => error instanceof HttpError && error.status === 415);
});
