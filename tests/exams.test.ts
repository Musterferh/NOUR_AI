import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  buildProgress, EXAM_DURATION_MS, gradeExam, isExpired, mergeAnswers, publicAttempt,
  validateGeneratedExam, type ExamQuestion, type GeneratedQuestion, type StoredExamAttempt,
} from '../src/lib/exams';

function generatedQuestions(): GeneratedQuestion[] {
  return Array.from({ length: 20 }, (_, index) => ({
    question: `Which principle applies in regulatory scenario ${index + 1}?`,
    topic: index < 10 ? 'Licensing' : 'Spectrum',
    options: { A: 'The statutory process', B: 'An informal agreement', C: 'A draft consultation', D: 'No process' },
    correctAnswer: 'A',
    explanation: '[CURRENT] The supplied statute requires the statutory process; a consultation is not law.',
    sourceIds: ['source-1'],
  }));
}

function storedAttempt(overrides: Partial<StoredExamAttempt> = {}): StoredExamAttempt {
  return {
    id: randomUUID(), ownerId: 'private', category: 'NCA 2003',
    questions: JSON.stringify(generatedQuestions().map(question => ({ ...question, id: randomUUID() }))),
    sources: JSON.stringify([{ id: 'source-1', title: 'Master bank', section: 'Chapter 1', status: 'CURRENT', excerpt: 'Statutory text.' }]),
    answers: '{}', revision: 0,
    startedAt: new Date('2026-01-01T10:00:00.000Z'),
    expiresAt: new Date('2026-01-01T10:30:00.000Z'),
    submittedAt: null, score: null,
    ...overrides,
  };
}

test('generated exam must contain exactly 20 complete questions', () => {
  assert.equal(validateGeneratedExam(generatedQuestions(), new Set(['source-1'])).length, 20);
  assert.throws(() => validateGeneratedExam([null], new Set(['source-1'])));
  assert.throws(() => validateGeneratedExam(generatedQuestions().slice(0, 19), new Set(['source-1'])));
  const missingAnswer = generatedQuestions().map(question => ({ ...question, correctAnswer: undefined }));
  assert.throws(() => validateGeneratedExam(missingAnswer, new Set(['source-1'])));
  const missingOptions = generatedQuestions().map(question => ({ ...question, options: undefined }));
  assert.throws(() => validateGeneratedExam(missingOptions, new Set(['source-1'])));
});

test('exam rejects invented citations, duplicate questions and indistinguishable options', () => {
  assert.throws(() => validateGeneratedExam(generatedQuestions(), new Set(['another-source'])));
  const repeated = generatedQuestions();
  repeated[1].question = repeated[0].question.toUpperCase();
  assert.throws(() => validateGeneratedExam(repeated, new Set(['source-1'])));
  const duplicateOptions = generatedQuestions();
  duplicateOptions[0].options.B = ' THE STATUTORY PROCESS ';
  assert.throws(() => validateGeneratedExam(duplicateOptions, new Set(['source-1'])));
  const duplicateCitation = generatedQuestions();
  duplicateCitation[0].sourceIds = ['source-1', 'source-1'];
  assert.throws(() => validateGeneratedExam(duplicateCitation, new Set(['source-1'])));
});

test('active attempt hides its answer key, explanations and owner identity', () => {
  const attempt = storedAttempt();
  const response = publicAttempt(attempt);
  assert.equal(response.questions.length, 20);
  assert.equal(response.sources[0].id, 'source-1');
  for (const question of response.questions) {
    assert.equal('correctAnswer' in question, false);
    assert.equal('explanation' in question, false);
  }
  assert.equal('ownerId' in response, false);
  assert.equal('score' in response, false);
  assert.equal(response.expiresAt, '2026-01-01T10:30:00.000Z');
  const completed = publicAttempt({ ...attempt, submittedAt: new Date(), score: 50 });
  assert.equal(completed.score, 50);
  assert.ok('correctAnswer' in completed.questions[0]);
  assert.ok('explanation' in completed.questions[0]);
});

test('server grading counts wrong and unanswered questions as incorrect', () => {
  const questions = JSON.parse(storedAttempt().questions) as ExamQuestion[];
  assert.equal(gradeExam(questions, {}), 0);
  assert.equal(gradeExam(questions, { [questions[0].id]: 'A', [questions[1].id]: 'B' }), 5);
  assert.equal(gradeExam(questions, Object.fromEntries(questions.map(question => [question.id, 'A']))), 100);
});

test('answer updates preserve previous answers and reject another attempt’s question IDs', () => {
  const questions = JSON.parse(storedAttempt().questions) as ExamQuestion[];
  assert.deepEqual(mergeAnswers(questions, { [questions[0].id]: 'A' }, { [questions[1].id]: 'C' }), {
    [questions[0].id]: 'A', [questions[1].id]: 'C',
  });
  assert.throws(() => mergeAnswers(questions, {}, { [randomUUID()]: 'A' }));
});

test('deadline uses absolute server time and expires at the exact boundary', () => {
  const attempt = storedAttempt();
  assert.equal(attempt.expiresAt.getTime() - attempt.startedAt.getTime(), EXAM_DURATION_MS);
  assert.equal(isExpired(attempt, new Date('2026-01-01T10:29:59.999Z')), false);
  assert.equal(isExpired(attempt, new Date('2026-01-01T10:30:00.000Z')), true);
  assert.equal(isExpired(attempt, new Date('2026-01-02T10:00:00.000Z')), true);
});

test('progress summarizes completed work only and retains source-backed mistakes', () => {
  const completed = storedAttempt({ submittedAt: new Date('2026-01-01T10:25:00.000Z'), score: 50 });
  const questions = JSON.parse(completed.questions) as ExamQuestion[];
  completed.answers = JSON.stringify(Object.fromEntries(questions.slice(0, 10).map(question => [question.id, 'A'])));
  const active = storedAttempt();
  const progress = buildProgress([active, completed]);
  assert.equal(progress.attempts.length, 2);
  assert.deepEqual(progress.weakTopics, [
    { topic: 'Spectrum', total: 10, correct: 0, accuracy: 0 },
    { topic: 'Licensing', total: 10, correct: 10, accuracy: 100 },
  ]);
  assert.deepEqual(progress.recommendedTopics, ['Spectrum']);
  assert.equal(progress.mistakes.length, 10);
  assert.equal(progress.mistakes[0].answer, null);
  assert.equal(progress.mistakes[0].sources[0].id, 'source-1');
  assert.equal(progress.attempts[0].answered, 0);
});
