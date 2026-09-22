import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { apiError, HttpError, json, readJson } from '@/lib/http';
import { CATEGORIES, MODES } from '@/lib/config';
import { enforceQuota } from '@/lib/security';

const settings = z.object({ title: z.string().trim().min(1).max(100).optional(), category: z.enum(CATEGORIES).optional(), mode: z.enum(MODES).optional() });

export async function GET(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const cursor = new URL(req.url).searchParams.get('cursor');
    if (cursor && !await prisma.session.findFirst({ where: { id: cursor, ownerId } })) throw new HttpError(400, 'Invalid session cursor.');
    const sessions = await prisma.session.findMany({ where: { ownerId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const response = json(sessions);
    if (sessions.length === 100) response.headers.set('X-Next-Cursor', sessions[99].id);
    return response;
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const body = await readJson(req, settings);
    await enforceQuota(ownerId, 'write');
    return json(await prisma.session.create({ data: { ownerId, title: body.title || 'New Chat', category: body.category || 'NCA 2003', mode: body.mode || MODES[0] } }), 201);
  } catch (error) { return apiError(error); }
}

export async function PATCH(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const { id, ...data } = await readJson(req, settings.extend({ id: z.string().min(1).max(100) }));
    await enforceQuota(ownerId, 'write');
    if (await prisma.requestLease.findFirst({ where: { id: `chat:${id}`, expiresAt: { gt: new Date() } } })) throw new HttpError(409, 'Stop the current response before changing its topic or mode.');
    const result = await prisma.session.updateMany({ where: { id, ownerId }, data });
    if (!result.count) throw new HttpError(404, 'Session not found.');
    return json(await prisma.session.findFirst({ where: { id, ownerId } }));
  } catch (error) { return apiError(error); }
}

export async function DELETE(req: Request) {
  try {
    const ownerId = await requireOwner(req);
    const id = new URL(req.url).searchParams.get('id');
    if (!id || id.length > 100) throw new HttpError(400, 'A session ID is required.');
    await enforceQuota(ownerId, 'write');
    const result = await prisma.session.deleteMany({ where: { id, ownerId } });
    if (!result.count) throw new HttpError(404, 'Session not found.');
    return json({ success: true });
  } catch (error) { return apiError(error); }
}
