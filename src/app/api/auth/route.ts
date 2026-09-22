import { z } from 'zod';
import { authSettings, assertSameOrigin, createAuthSession, getAuthSession, sessionCookie } from '@/lib/auth';
import { constantTimeEqual } from '@/lib/auth-token';
import { apiError, HttpError, json, readJson } from '@/lib/http';
import { enforceQuota } from '@/lib/security';
import { prisma } from '@/lib/prisma';
import { getKimiSetupStatus } from '@/lib/kimi';

export async function GET(req: Request) {
  try {
    const settings = authSettings(req);
    const authenticated = !!await getAuthSession(req);
    return json({ authenticated, requiresPassword: !!settings.password, ...(authenticated ? { coaching: getKimiSetupStatus() } : {}) });
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { password } = await readJson(req, z.object({ password: z.string().max(1024) }), 2048);
    const settings = authSettings(req);
    await enforceQuota('private-access', 'login');
    if (!constantTimeEqual(password, settings.password)) throw new HttpError(401, 'The password is incorrect.');
    const response = json({ authenticated: true, requiresPassword: !!settings.password });
    response.headers.set('Set-Cookie', await createAuthSession(req));
    return response;
  } catch (error) { return apiError(error); }
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    const session = await getAuthSession(req);
    if (session) await prisma.authSession.deleteMany({ where: { id: session.id } });
    const response = json({ authenticated: false });
    response.headers.set('Set-Cookie', sessionCookie(req, '', 0));
    return response;
  } catch (error) { return apiError(error); }
}
