import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  buildProgress, EXAM_DURATION_MS, EXAM_QUESTION_COUNT, gradeExam, isExpired, mergeAnswers, publicAttempt,
  validateGeneratedExam, type ExamQuestion, type GeneratedQuestion, type StoredExamAttempt,
} from '../src/lib/exams';

const licensingCount = Math.floor(EXAM_QUESTION_COUNT / 2);

function generatedQuestions(): GeneratedQuestion[] {
  return Array.from({ length: EXAM_QUESTION_COUNT }, (_, index) => ({
    question: `Which principle applies in regulatory scenario ${index + 1}?`,
    topic: index < licensingCount ? 'Licensing' : 'Spectrum',
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

test('generated exam must contain the configured number of complete questions', () => {
  assert.equal(validateGeneratedExam(generatedQuestions(), new Set(['source-1'])).length, EXAM_QUESTION_COUNT);
  assert.throws(() => validateGeneratedExam([null], new Set(['source-1'])));
  assert.throws(() => validateGeneratedExam(generatedQuestions().slice(0, EXAM_QUESTION_COUNT - 1), new Set(['source-1'])));
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
  assert.equal(response.questions.length, EXAM_QUESTION_COUNT);
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
  assert.equal(gradeExam(questions, { [questions[0].id]: 'A', [questions[1].id]: 'B' }), Math.round(100 / EXAM_QUESTION_COUNT));
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
  const completed = storedAttempt({ submittedAt: new Date('2026-01-01T10:25:00.000Z'), score: Math.round(licensingCount / EXAM_QUESTION_COUNT * 100) });
  const questions = JSON.parse(completed.questions) as ExamQuestion[];
  completed.answers = JSON.stringify(Object.fromEntries(questions.slice(0, licensingCount).map(question => [question.id, 'A'])));
  const active = storedAttempt();
  const progress = buildProgress([active, completed]);
  assert.equal(progress.attempts.length, 2);
  assert.deepEqual(progress.weakTopics, [
    { topic: 'Spectrum', total: EXAM_QUESTION_COUNT - licensingCount, correct: 0, accuracy: 0 },
    { topic: 'Licensing', total: licensingCount, correct: licensingCount, accuracy: 100 },
  ]);
  assert.deepEqual(progress.recommendedTopics, ['Spectrum']);
  assert.equal(progress.mistakes.length, EXAM_QUESTION_COUNT - licensingCount);
  assert.equal(progress.mistakes[0].answer, null);
  assert.equal(progress.mistakes[0].sources[0].id, 'source-1');
  assert.equal(progress.attempts[0].answered, 0);
});
