import { requireOwner } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { buildProgress } from '@/lib/exams';
import { finalizeExpiredAttempt } from '@/lib/exam-store';

export async function GET(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const attempts = await prisma.examAttempt.findMany({
      where: { ownerId }, orderBy: { startedAt: 'desc' }, take: 100,
    });
    // Sequential finalization avoids racing writes on SQLite and keeps expired exams available as results.
    const finalized = [];
    for (const attempt of attempts) finalized.push(await finalizeExpiredAttempt(attempt));
    return Response.json(buildProgress(finalized), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
