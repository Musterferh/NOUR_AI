import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { apiError, readJson, HttpError } from '@/lib/http';
import { enforceQuota } from '@/lib/security';
import { prisma } from '@/lib/prisma';
import { publicAttempt, saveAnswersSchema } from '@/lib/exams';
import { findOwnedAttempt, finalizeExpiredAttempt, saveAttemptAnswers } from '@/lib/exam-store';

export async function GET(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const id = new URL(req.url).searchParams.get('id');
    if (id !== null && !z.string().uuid().safeParse(id).success) throw new HttpError(400, 'Invalid exam ID.');
    const attempt = id
      ? await findOwnedAttempt(ownerId, id)
      : await prisma.examAttempt.findFirst({ where: { ownerId, submittedAt: null }, orderBy: { startedAt: 'desc' } });
    return Response.json(attempt ? publicAttempt(await finalizeExpiredAttempt(attempt)) : null,
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const { id, answers, revision } = await readJson(req, saveAnswersSchema, 4096);
    await enforceQuota(ownerId, 'write');
    const attempt = await saveAttemptAnswers(ownerId, id, answers, revision);
    return Response.json(publicAttempt(attempt), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
