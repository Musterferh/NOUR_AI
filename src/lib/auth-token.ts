import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface AuthClaims { sub: string; jti: string; exp: number }
export function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}
export function signAuthToken(claims: AuthClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifyAuthToken(token: string, secret: string, now = Date.now()): AuthClaims | null {
  if (token.length > 2048) return null;
  const pieces = token.split('.');
  if (pieces.length !== 2) return null;
  const [payload, signature] = pieces;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object') return null;
    const c = claims as AuthClaims;
    return typeof c.sub === 'string' && typeof c.jti === 'string' && c.jti.length <= 100 && Number.isSafeInteger(c.exp) && c.exp > now ? c : null;
  } catch { return null; }
}
