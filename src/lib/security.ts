import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { positiveInteger } from './config';
import { HttpError } from './http';

type QuotaKind = 'chat' | 'exam' | 'speech' | 'transcribe' | 'write' | 'login';
const HOURLY: Record<QuotaKind, number> = { chat: 90, exam: 6, speech: 90, transcribe: 90, write: 600, login: 20 };

export async function enforceQuota(ownerId: string, kind: QuotaKind): Promise<void> {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  const limits = [{ id: `${ownerId}:${kind}:${hour}`, limit: HOURLY[kind], expiresAt: new Date((hour + 1) * 3_600_000) }];
  if (!['write', 'login'].includes(kind)) limits.push({ id: `${ownerId}:paid:${day}`, limit: positiveInteger(process.env.DAILY_AI_REQUEST_LIMIT, 300), expiresAt: new Date((day + 1) * 86_400_000) });
  await prisma.$transaction(async tx => {
    for (const bucket of limits) {
      await tx.usageBucket.upsert({ where: { id: bucket.id }, create: { id: bucket.id, expiresAt: bucket.expiresAt, count: 0 }, update: {} });
      const result = await tx.usageBucket.updateMany({ where: { id: bucket.id, count: { lt: bucket.limit } }, data: { count: { increment: 1 } } });
      if (result.count !== 1) throw new HttpError(429, 'Your study request limit has been reached. Please wait before trying again.');
    }
    await tx.usageBucket.deleteMany({ where: { expiresAt: { lt: new Date(now - 86_400_000) } } });
  });
}

/** Database leases prevent concurrent paid jobs across multiple server instances. */
export async function acquireLease(id: string, durationMs = 180_000): Promise<() => Promise<void>> {
  const token = randomUUID();
  await prisma.requestLease.deleteMany({ where: { id, expiresAt: { lte: new Date() } } });
  try { await prisma.requestLease.create({ data: { id, token, expiresAt: new Date(Date.now() + durationMs) } }); }
  catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new HttpError(409, 'A response is already in progress. Please wait or stop it first.');
    throw error;
  }
  return async () => { await prisma.requestLease.deleteMany({ where: { id, token } }); };
}
