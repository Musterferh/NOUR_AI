import { z } from 'zod';
import { authSettings, assertSameOrigin, createAuthSession, getAuthSession, sessionCookie } from '@/lib/auth';
import { constantTimeEqual } from '@/lib/auth-token';
import { apiError, HttpError, json, readJson } from '@/lib/http';
import { enforceQuota } from '@/lib/security';
import { prisma } from '@/lib/prisma';
import { getKimiSetupStatus } from '@/lib/kimi';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export async function GET(req: Request) {
  try {
    const settings = authSettings(req);
    const authenticated = !!await getAuthSession(req);
    return json({ authenticated, requiresPassword: true, ...(authenticated ? { coaching: getKimiSetupStatus() } : {}) });
  } catch (error) { return apiError(error); }
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, key] = storedHash.split(':');
  const hashedBuffer = scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  return timingSafeEqual(hashedBuffer, keyBuffer);
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await readJson(req, z.object({ 
      username: z.string().max(255).optional(),
      password: z.string().min(1).max(1024),
      action: z.enum(['login', 'register']).default('login')
    }), 4096);
    
    await enforceQuota('private-access', 'login');
    
    let ownerId = 'private';

    if (body.action === 'register') {
      if (!body.username) throw new HttpError(400, 'Username is required to register.');
      const existing = await prisma.user.findUnique({ where: { username: body.username } });
      if (existing) throw new HttpError(400, 'Username is already taken.');
      
      const user = await prisma.user.create({
        data: { username: body.username, password: hashPassword(body.password) }
      });
      ownerId = user.id;
    } else {
      if (!body.username) {
        const settings = authSettings(req);
        if (!constantTimeEqual(body.password, settings.password)) throw new HttpError(401, 'The password is incorrect.');
      } else {
        const user = await prisma.user.findUnique({ where: { username: body.username } });
        if (!user || !verifyPassword(body.password, user.password)) {
          throw new HttpError(401, 'Invalid username or password.');
        }
        ownerId = user.id;
      }
    }

    const response = json({ authenticated: true, requiresPassword: true });
    response.headers.set('Set-Cookie', await createAuthSession(req, ownerId));
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
