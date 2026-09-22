import { prisma } from './prisma';
import { HttpError } from './http';
import {
  decodeAnswers, decodeQuestions, gradeExam, isExpired, mergeAnswers,
  type ExamAnswers, type StoredExamAttempt,
} from './exams';

export async function findOwnedAttempt(ownerId: string, id: string): Promise<StoredExamAttempt> {
  const attempt = await prisma.examAttempt.findFirst({ where: { id, ownerId } });
  if (!attempt) throw new HttpError(404, 'Exam attempt not found.');
  return attempt;
}

function validatedAnswers(attempt: StoredExamAttempt, updates: ExamAnswers) {
  try {
    return mergeAnswers(decodeQuestions(attempt), decodeAnswers(attempt), updates);
  } catch {
    throw new HttpError(400, 'Answers must refer to questions in this exam and use A, B, C, or D.');
  }
}

/** Compare-and-swap prevents a late save from overwriting a submitted attempt. */
export async function saveAttemptAnswers(ownerId: string, id: string, answers: ExamAnswers, revision: number) {
  const attempt = await findOwnedAttempt(ownerId, id);
  if (attempt.submittedAt) throw new HttpError(409, 'This exam has already been submitted.');
  const now = new Date();
  if (isExpired(attempt, now)) return submitAttempt(ownerId, id, {});
  if (attempt.revision !== revision) {
    throw new HttpError(409, 'This exam changed in another request. Reload it before saving again.');
  }
  const merged = validatedAnswers(attempt, answers);
  const result = await prisma.examAttempt.updateMany({
    where: { id, ownerId, revision, submittedAt: null, expiresAt: { gt: now } },
    data: { answers: JSON.stringify(merged), revision: { increment: 1 } },
  });
  if (result.count !== 1) {
    const current = await findOwnedAttempt(ownerId, id);
    if (current.submittedAt) return current;
    if (isExpired(current)) return submitAttempt(ownerId, id, {});
    throw new HttpError(409, 'This exam changed in another request. Reload it before saving again.');
  }
  return findOwnedAttempt(ownerId, id);
}

/** Grading happens once on the server; answers arriving after expiry are ignored. */
export async function submitAttempt(ownerId: string, id: string, updates: ExamAnswers): Promise<StoredExamAttempt> {
  for (let retry = 0; retry < 3; retry++) {
    const attempt = await findOwnedAttempt(ownerId, id);
    if (attempt.submittedAt) return attempt;
    const now = new Date();
    const expired = isExpired(attempt, now);
    const questions = decodeQuestions(attempt);
    const answers = expired ? decodeAnswers(attempt) : validatedAnswers(attempt, updates);
    const result = await prisma.examAttempt.updateMany({
      where: {
        id, ownerId, revision: attempt.revision, submittedAt: null,
        expiresAt: expired ? { lte: now } : { gt: now },
      },
      data: {
        answers: JSON.stringify(answers),
        score: gradeExam(questions, answers),
        submittedAt: now,
        revision: { increment: 1 },
      },
    });
    if (result.count === 1) return findOwnedAttempt(ownerId, id);
  }
  throw new HttpError(409, 'The exam is being updated. Please retry submitting.');
}

export async function finalizeExpiredAttempt(attempt: StoredExamAttempt): Promise<StoredExamAttempt> {
  return !attempt.submittedAt && isExpired(attempt)
    ? submitAttempt(attempt.ownerId, attempt.id, {})
    : attempt;
}
