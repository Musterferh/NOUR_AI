import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundHistory, buildCoachMessages, citationNotice, wantsPersonalRevision } from '../src/lib/coaching';

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

test('invented citations are flagged without treating uncited clarifications as factual failures', () => {
  const sources = [{ id: 'reviewed-1', title: 'Study source', status: 'VERIFY', excerpt: 'Evidence' }];
  assert.equal(citationNotice('Which question do you mean?', sources), undefined);
  assert.equal(citationNotice('Calculation: 2 + 2 = 4.', sources), undefined);
  assert.match(citationNotice('Claim [source:invented.id]', sources)!, /not supplied/);
  assert.match(citationNotice('Claim [source:invented]', [])!, /not supplied/);
  assert.equal(citationNotice('Claim [source:reviewed-1]', sources), undefined);
  assert.equal(citationNotice('Claim [source: reviewed-1 ]', sources), undefined);
  assert.equal(citationNotice('Claim [source: reviewed-1; source:reviewed-1]', sources), undefined);
  assert.match(citationNotice('Claim [source: reviewed-1; source:invented]', sources)!, /not supplied/);
  assert.equal(citationNotice('I need more evidence.', []), undefined);
});

test('runtime evidence rules supersede persona claims and identify missing evidence', () => {
  const messages = buildCoachMessages({ category: 'General', mode: 'MODE 1 — TEACH', context: '', sources: [], history: [], message: 'What changed today?', learningRecord: {} });
  assert.match(messages[0].content, /override conflicting persona/);
  assert.match(messages[0].content, /No matching study evidence/);
  assert.match(messages[0].content, /Do not expose private internal reasoning/);
});
