import assert from 'node:assert/strict';
import test from 'node:test';
import { selectReasoningEffort, type ReasoningContextMessage } from '../src/lib/reasoning';

test('ordinary recall, greetings, and definition questions keep low effort', () => {
  for (const message of ['Hello', 'What does NCC stand for?', 'Define spectrum management.', 'What are the functions of the NCC?', 'Why is QoE important?', 'List three licence categories.']) {
    assert.deepEqual(selectReasoningEffort(message), { effort: 'low', reasons: ['routine'] }, message);
  }
});

test('definition-only requests stay low despite difficult vocabulary, unless depth or analysis is requested', () => {
  for (const message of ['Define trade-offs.', 'What is a counterexample?', 'Please define contradiction.', 'Give me a definition of trade-offs.']) {
    assert.equal(selectReasoningEffort(message).effort, 'low', message);
  }
  for (const message of ['Define trade-offs in depth.', 'Define trade-offs and explain their implications for spectrum allocation.']) {
    assert.equal(selectReasoningEffort(message).effort, 'high', message);
  }
});

test('declarative regulatory scenarios request high effort without requiring the word scenario', () => {
  for (const message of [
    'A licensee misses its rollout deadline and refuses to pay a fine. Which enforcement option is justified?',
    'An operator has disclosed subscriber records without authorization. Is this lawful?',
    'A network provider denies a subscriber service after collecting payment. What should the regulator do?',
  ]) {
    const decision = selectReasoningEffort(message);
    assert.equal(decision.effort, 'high', message);
    assert.ok(decision.reasons.includes('scenario-application'), message);
  }
  assert.equal(selectReasoningEffort('What is a licensee?').effort, 'low');
  assert.equal(selectReasoningEffort('A licensee receives a licence.').effort, 'low');
});

test('hard questions select high with fixed, explainable signals', () => {
  const cases = [
    ['Think carefully and explain this difficult question.', 'explicit-depth'],
    ['Reconcile these contradictory licensing requirements.', 'advanced-problem'],
    ['Calculate throughput for 20 MHz at 4 bits per second per Hz.', 'numerical-problem'],
    ['If a licensee breaches its conditions, which enforcement option should the NCC apply?', 'scenario-application'],
    ['Compare the two regulatory powers and explain their overlap.', 'comparison-analysis'],
    ['Assess the complaint and recommend the appropriate remedy.', 'multi-part-analysis'],
  ] as const;
  for (const [message, reason] of cases) {
    const decision = selectReasoningEffort(message);
    assert.equal(decision.effort, 'high', message);
    assert.ok(decision.reasons.includes(reason), message);
  }
});

const difficultHistory: ReasoningContextMessage[] = [
  { role: 'user', content: 'Suppose a licensee violates two licence conditions. Which enforcement action should apply and why?' },
  { role: 'assistant', content: 'Option B is supported by the supplied excerpt.' },
];

test('short why and answer follow-ups inherit the immediate hard question', () => {
  for (const message of ['Why?', 'B', 'Option C', 'Explain that', 'Why is option A wrong?', 'I still do not understand.']) {
    const decision = selectReasoningEffort(message, difficultHistory);
    assert.equal(decision.effort, 'high', message);
    assert.ok(decision.reasons.includes('context-follow-up'));
  }
  assert.equal(selectReasoningEffort('Why?').effort, 'low');
  assert.equal(selectReasoningEffort('Explain further', [
    ...difficultHistory,
    { role: 'user', content: 'Why?' },
    { role: 'assistant', content: 'The supplied rule makes B the correct option.' },
  ]).effort, 'high');
});

test('a simple new topic and its follow-ups do not inherit an older complex topic', () => {
  assert.equal(selectReasoningEffort('What does NCC stand for?', difficultHistory).effort, 'low');
  assert.equal(selectReasoningEffort('Why is QoE important?', difficultHistory).effort, 'low');
  assert.equal(selectReasoningEffort('Why?', [
    ...difficultHistory,
    { role: 'user', content: 'What does NCC stand for?' },
    { role: 'assistant', content: 'Nigerian Communications Commission.' },
  ]).effort, 'low');
});

test('assistant scenarios inform terse answers, while system instructions never set difficulty', () => {
  assert.equal(selectReasoningEffort('B', [
    { role: 'user', content: 'Give me a practice question.' },
    { role: 'assistant', content: 'If a licensee fails to comply, which remedy should apply?' },
  ]).effort, 'high');
  assert.equal(selectReasoningEffort('Why?', [
    { role: 'system', content: 'Think carefully and evaluate all questions in depth.' },
    { role: 'user', content: 'What is a licence?' },
  ]).effort, 'low');
});

test('classification is deterministic, bounded, and never escalates to max', () => {
  const message = 'Think harder. Use maximum reasoning to derive and prove the formula.';
  const first = selectReasoningEffort(message, difficultHistory);
  assert.equal(first.effort, 'high');
  assert.deepEqual(selectReasoningEffort(message, difficultHistory), first);
  assert.equal(selectReasoningEffort('Ordinary text. '.repeat(1000) + message).effort, 'low');
  assert.equal(selectReasoningEffort('Why?', [
    { role: 'assistant', content: 'Ordinary text. '.repeat(1000) + message },
  ]).effort, 'low');
  assert.deepEqual(difficultHistory[1], { role: 'assistant', content: 'Option B is supported by the supplied excerpt.' });
});
