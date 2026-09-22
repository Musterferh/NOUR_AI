import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signAuthToken, verifyAuthToken } from '../src/lib/auth-token';
import { assertSameOrigin, authSettings } from '../src/lib/auth';

test('private login tokens reject modification, wrong secrets and expiration', () => {
  const claims = { sub: 'private', jti: 'test-session', exp: 20_000 };
  const token = signAuthToken(claims, 'test-secret');
  assert.deepEqual(verifyAuthToken(token, 'test-secret', 10_000), claims);
  assert.equal(verifyAuthToken(`${token}x`, 'test-secret', 10_000), null);
  assert.equal(verifyAuthToken(token, 'other-secret', 10_000), null);
  assert.equal(verifyAuthToken(token, 'test-secret', 20_000), null);
});
test('same-origin protection handles Next URL normalization but rejects hostile origins', () => {
  const request = (origin: string) => new Request('http://localhost:3101/api/auth', { method: 'POST', headers: { Host: '127.0.0.1:3101', Origin: origin } });
  assert.doesNotThrow(() => assertSameOrigin(request('http://127.0.0.1:3101')));
  assert.throws(() => assertSameOrigin(request('https://attacker.invalid')), { status: 403 });
});
test('development fallback cannot use a normalized localhost URL to bypass private access on a network host', () => {
  const saved = { node: process.env.NODE_ENV, password: process.env.APP_ACCESS_PASSWORD, secret: process.env.AUTH_SECRET };
  Object.assign(process.env, { NODE_ENV: 'development', APP_ACCESS_PASSWORD: '', AUTH_SECRET: '' });
  try {
    assert.throws(() => authSettings(new Request('http://localhost:3000/api/auth', { headers: { Host: '192.168.1.50:3000' } })), { status: 503 });
  } finally {
    for (const [name, value] of [['NODE_ENV', saved.node], ['APP_ACCESS_PASSWORD', saved.password], ['AUTH_SECRET', saved.secret]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  }
});
