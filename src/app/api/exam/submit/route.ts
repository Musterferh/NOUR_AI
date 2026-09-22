import { requireOwner } from '@/lib/auth';
import { apiError, readJson } from '@/lib/http';
import { enforceQuota } from '@/lib/security';
import { publicAttempt, submitExamSchema } from '@/lib/exams';
import { submitAttempt } from '@/lib/exam-store';

export async function POST(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const { id, answers } = await readJson(req, submitExamSchema, 4096);
    await enforceQuota(ownerId, 'write');
    const attempt = await submitAttempt(ownerId, id, answers);
    return Response.json(publicAttempt(attempt), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
