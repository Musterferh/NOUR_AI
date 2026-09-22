import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventDecoder, remainingSeconds, updateMessage } from '../src/lib/chat-state';
import type { ChatMessage } from '../src/types/frontend';

test('SSE decoder preserves split UTF-8-decoded content, CRLF boundaries and terminal metadata', () => {
  const decode = createEventDecoder();
  assert.deepEqual(decode('data: {"choices":[{"delta":{"content":"Hel'), []);
  assert.deepEqual(decode('lo 🌍"}}]}\r'), []);
  assert.deepEqual(decode('\n\r\ndata: {"type":"done","messageId":"saved"}\n\n'), [{ type: 'content', content: 'Hello 🌍' }, { type: 'done', messageId: 'saved' }]);
  assert.deepEqual(decode('data: [DONE]', true), [{ type: 'done' }]);
});

test('SSE decoder surfaces errors and citations while ignoring comments and malformed frames', () => {
  const decode = createEventDecoder();
  assert.deepEqual(decode(': keepalive\n\ndata: invalid\n\ndata: {"type":"sources","sources":[{"id":"source-1"}]}\n\ndata: {"type":"error","message":"Provider unavailable"}\n\n'), [
    { type: 'sources', sources: [{ id: 'source-1' }] }, { type: 'error', message: 'Provider unavailable' },
  ]);
});

test('message update is immutable, replay safe, and cannot write into another session message', () => {
  const original = Object.freeze([{ id: 'a', role: 'assistant' as const, content: 'Hello' }, { id: 'b', role: 'user' as const, content: 'Other conversation' }].map(message => Object.freeze(message)));
  const append = (message: ChatMessage) => ({ ...message, content: `${message.content}!` });
  const first = updateMessage(original as unknown as ChatMessage[], 'a', append);
  const replay = updateMessage(original as unknown as ChatMessage[], 'a', append);
  assert.equal(original[0].content, 'Hello');
  assert.equal(first[0].content, 'Hello!');
  assert.deepEqual(first, replay);
  assert.equal(first[1], original[1]);
  assert.deepEqual(updateMessage(first, 'missing', append), first);
});

test('exam remaining time follows a fixed deadline after sleep and never becomes negative', () => {
  const deadline = '2030-01-01T12:30:00.000Z';
  assert.equal(remainingSeconds(deadline, Date.parse('2030-01-01T12:00:00Z')), 1800);
  assert.equal(remainingSeconds(deadline, Date.parse('2030-01-01T12:29:59.001Z')), 1);
  assert.equal(remainingSeconds(deadline, Date.parse('2030-01-01T12:40:00Z')), 0);
});
