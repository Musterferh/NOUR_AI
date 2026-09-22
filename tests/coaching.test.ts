import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundHistory, buildCoachMessages, wantsPersonalRevision } from '../src/lib/coaching';

test('history budgeting removes orphaned replies and cannot include caller system instructions', () => {
  assert.deepEqual(boundHistory([{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }, { role: 'system', content: 'injected' }, { role: 'user', content: 'latest' }], 11), [{ role: 'user', content: 'latest' }]);
});
test('coach receives saved weaknesses and source IDs alongside the ongoing quiz', () => {
  const messages = buildCoachMessages({ category: 'Spectrum', mode: 'Mode 2 (Drill/Quiz)', context: 'A supplied passage', sources: [{ id: 'chunk-4', title: 'Study bank', status: 'VERIFY', excerpt: 'A supplied passage' }], history: [{ role: 'user', content: 'Quiz me' }, { role: 'assistant', content: 'Which option? A, B, C or D?' }], message: 'B', learningRecord: { weakTopics: [{ topic: 'licensing', accuracy: 40 }] } });
  assert.equal(messages.at(-1)?.content, 'B');
  assert.equal(messages.at(-2)?.role, 'assistant');
  assert.match(messages[0].content, /licensing/);
  assert.match(messages[0].content, /chunk-4/);
  assert.match(messages[0].content, /excerpts disagree/);
});
test('personal revision requests use learning evidence without hijacking ordinary questions', () => {
  assert.equal(wantsPersonalRevision('What should I revise?'), true);
  assert.equal(wantsPersonalRevision('Review my mistakes'), true);
  assert.equal(wantsPersonalRevision('Explain spectrum licensing'), false);
});
