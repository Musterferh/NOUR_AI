import { createHash, randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { HttpError } from './http';
import { signAuthToken, verifyAuthToken } from './auth-token';

export const AUTH_COOKIE = 'nour_private_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function authSettings(req: Request) {
  const password = process.env.APP_ACCESS_PASSWORD || '';
  const secret = process.env.AUTH_SECRET || '';
  const browserHost = req.headers.get('host');
  const hostname = browserHost ? new URL(`http://${browserHost}`).hostname : new URL(req.url).hostname;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  const development = process.env.NODE_ENV !== 'production' && local;
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new HttpError(503, 'Set DATABASE_URL to persistent storage before running in production.');
  if ((!password || !secret) && !development) throw new HttpError(503, 'Private access is not configured. Set APP_ACCESS_PASSWORD and AUTH_SECRET on the server.');
  if (password && password.length < 12 && !development) throw new HttpError(503, 'APP_ACCESS_PASSWORD must contain at least 12 characters outside local development.');
  if (secret && secret.length < 32) throw new HttpError(503, 'AUTH_SECRET must contain at least 32 characters.');
  return { password, secret: createHash('sha256').update(`${secret || 'nour-local-development-only'}:${password}`).digest('hex') };
}

export function assertSameOrigin(req: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
  const origin = req.headers.get('origin');
  // Next may normalize req.url to localhost even when the browser used 127.0.0.1.
  // The Host header is the browser-facing authority; proxy deployments should set
  // APP_ORIGIN explicitly rather than trusting arbitrary forwarded-host headers.
  const requestUrl = new URL(req.url);
  const authority = req.headers.get('host') || requestUrl.host;
  const expected = process.env.APP_ORIGIN || `${requestUrl.protocol}//${authority}`;
  if (origin && origin !== expected) throw new HttpError(403, 'This request did not originate from NOUR.');
}

function cookieValue(req: Request): string {
  return (req.headers.get('cookie') || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${AUTH_COOKIE}=`))?.slice(AUTH_COOKIE.length + 1) || '';
}

export async function getAuthSession(req: Request) {
  const { secret } = authSettings(req);
  const claims = verifyAuthToken(cookieValue(req), secret);
  if (!claims) return null;
  return prisma.authSession.findFirst({ where: { id: claims.jti, ownerId: claims.sub, expiresAt: { gt: new Date() } } });
}

export async function requireOwner(req: Request): Promise<string> {
  assertSameOrigin(req);
  const session = await getAuthSession(req);
  if (!session) throw new HttpError(401, 'Please unlock your private study space.');
  return session.ownerId;
}

export function sessionCookie(req: Request, value: string, maxAge: number) {
  const secure = new URL(req.url).protocol === 'https:' || process.env.NODE_ENV === 'production';
  return `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function createAuthSession(req: Request) {
  const { secret } = authSettings(req);
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const session = await prisma.authSession.create({ data: { id: randomUUID(), ownerId: 'private', expiresAt } });
  await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return sessionCookie(req, signAuthToken({ sub: session.ownerId, jti: session.id, exp: expiresAt.getTime() }, secret), SESSION_MS / 1000);
}
