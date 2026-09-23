import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EXAM_QUESTION_COUNT, type ExamQuestion, type StoredExamAttempt } from '../src/lib/exams';

test('persisted exam lifecycle enforces ownership, revisions, deadlines and one-time grading', async t => {
  const databasePath = path.join(os.tmpdir(), `nour-exam-test-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
  const { prisma } = await import('../src/lib/prisma');
  const { findOwnedAttempt, saveAttemptAnswers, submitAttempt, finalizeExpiredAttempt } = await import('../src/lib/exam-store');
  t.after(async () => {
    await prisma.$disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      await fs.rm(`${databasePath}${suffix}`, { force: true });
    }
  });
  await prisma.$executeRawUnsafe(`CREATE TABLE ExamAttempt (
    id TEXT PRIMARY KEY NOT NULL, ownerId TEXT NOT NULL, category TEXT NOT NULL,
    questions TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', sources TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0, startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL, submittedAt DATETIME, score REAL
  )`);

  async function createAttempt(overrides: Partial<StoredExamAttempt> = {}) {
    const questions: ExamQuestion[] = Array.from({ length: EXAM_QUESTION_COUNT }, (_, index) => ({
      id: randomUUID(), question: `What is the rule for scenario ${index + 1}?`, topic: 'Licensing',
      options: { A: 'A statute', B: 'A consultation', C: 'An initiative', D: 'An announcement' },
      correctAnswer: 'A', explanation: '[CURRENT] The statute defines this obligation.', sourceIds: ['source-1'],
    }));
    return prisma.examAttempt.create({ data: {
      ownerId: 'private', category: 'NCA 2003', questions: JSON.stringify(questions),
      expiresAt: new Date(Date.now() + 120_000), ...overrides,
    } });
  }

  await t.test('another owner cannot read or mutate an attempt', async () => {
    const attempt = await createAttempt();
    await assert.rejects(findOwnedAttempt('other', attempt.id), { status: 404 });
    await assert.rejects(saveAttemptAnswers('other', attempt.id, {}, 0), { status: 404 });
    await assert.rejects(submitAttempt('other', attempt.id, {}), { status: 404 });
  });

  await t.test('concurrent saves at the same revision cannot silently overwrite each other', async () => {
    const attempt = await createAttempt();
    const questions = JSON.parse(attempt.questions) as ExamQuestion[];
    const results = await Promise.allSettled([
      saveAttemptAnswers('private', attempt.id, { [questions[0].id]: 'A' }, 0),
      saveAttemptAnswers('private', attempt.id, { [questions[1].id]: 'B' }, 0),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failure.reason.status, 409);
    const saved = await findOwnedAttempt('private', attempt.id);
    assert.equal(saved.revision, 1);
    assert.equal(Object.keys(JSON.parse(saved.answers)).length, 1);
  });

  await t.test('expired submissions grade only the answers saved before the deadline', async () => {
    const attempt = await createAttempt({ expiresAt: new Date(Date.now() - 1000) });
    const questions = JSON.parse(attempt.questions) as ExamQuestion[];
    await prisma.examAttempt.update({ where: { id: attempt.id }, data: {
      answers: JSON.stringify({ [questions[0].id]: 'A' }),
    } });
    const lateAnswers = Object.fromEntries(questions.map(question => [question.id, 'A' as const]));
    const submitted = await submitAttempt('private', attempt.id, lateAnswers);
    assert.equal(submitted.score, Math.round(100 / EXAM_QUESTION_COUNT));
    assert.equal(Object.keys(JSON.parse(submitted.answers)).length, 1);
    assert.ok(submitted.submittedAt);
  });

  await t.test('repeat submission returns the original grade and no later save can alter it', async () => {
    const attempt = await createAttempt();
    const questions = JSON.parse(attempt.questions) as ExamQuestion[];
    const submitted = await submitAttempt('private', attempt.id, { [questions[0].id]: 'B' });
    const repeated = await submitAttempt('private', attempt.id, { [questions[0].id]: 'A' });
    assert.equal(submitted.score, 0);
    assert.equal(repeated.score, submitted.score);
    assert.equal(repeated.submittedAt?.getTime(), submitted.submittedAt?.getTime());
    await assert.rejects(saveAttemptAnswers('private', attempt.id, { [questions[0].id]: 'A' }, repeated.revision), { status: 409 });
  });

  await t.test('resume finalizes expired attempts without extending their deadline', async () => {
    const expiresAt = new Date(Date.now() - 1000);
    const attempt = await createAttempt({ expiresAt });
    const resumed = await finalizeExpiredAttempt(attempt);
    assert.equal(resumed.expiresAt.getTime(), expiresAt.getTime());
    assert.equal(resumed.score, 0);
    assert.ok(resumed.submittedAt);
  });

  await t.test('a question from a different exam is rejected before persistence', async () => {
    const attempt = await createAttempt();
    await assert.rejects(saveAttemptAnswers('private', attempt.id, { [randomUUID()]: 'A' }, 0), { status: 400 });
    assert.equal((await findOwnedAttempt('private', attempt.id)).revision, 0);
  });
});
