import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('private API security integrates login, ownership, request bounds, quotas and leases', async t => {
  const databasePath = path.join(os.tmpdir(), `nour-security-test-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
  process.env.APP_ACCESS_PASSWORD = 'test-only-password-123';
  process.env.AUTH_SECRET = 'test-only-secret-with-at-least-32-characters';
  const { prisma } = await import('../src/lib/prisma');
  t.after(async () => {
    await prisma.$disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) await fs.rm(`${databasePath}${suffix}`, { force: true });
  });
  for (const file of ['001_initial.sql', '002_private_learning.sql']) {
    const sql = await fs.readFile(path.join(process.cwd(), 'prisma', 'migrations', file), 'utf8');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
  }
  const auth = await import('../src/app/api/auth/route');
  const sessions = await import('../src/app/api/sessions/route');
  const messages = await import('../src/app/api/messages/route');
  const { acquireLease, enforceQuota } = await import('../src/lib/security');
  const { authSettings } = await import('../src/lib/auth');
  const request = (route: string, method = 'GET', body?: unknown, cookie?: string, extra?: HeadersInit) => new Request(`http://localhost${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let cookie: string;
  await t.test('anonymous requests cannot list private sessions or messages', async () => {
    assert.equal((await sessions.GET(request('/api/sessions'))).status, 401);
    assert.equal((await messages.GET(request('/api/messages?sessionId=any'))).status, 401);
    assert.equal((await auth.POST(request('/api/auth', 'POST', { password: 'wrong' }))).status, 401);
    const response = await auth.POST(request('/api/auth', 'POST', { password: process.env.APP_ACCESS_PASSWORD }));
    assert.equal(response.status, 200);
    const header = response.headers.get('Set-Cookie')!;
    assert.match(header, /HttpOnly; SameSite=Strict/);
    cookie = header.split(';')[0];
    assert.equal((await auth.GET(request('/api/auth', 'GET', undefined, cookie))).status, 200);
  });
  await t.test('CSRF and oversized JSON are rejected before mutation', async () => {
    const response = await sessions.POST(request('/api/sessions', 'POST', {}, cookie, { Origin: 'https://attacker.invalid' }));
    assert.equal(response.status, 403);
    assert.equal((await auth.POST(request('/api/auth', 'POST', { password: 'x'.repeat(3000) }))).status, 413);
    assert.equal((await sessions.POST(request('/api/sessions', 'POST', {}, cookie, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
    assert.equal(await prisma.session.count(), 0);
  });
  await t.test('session listing, message reading and deletion are scoped to the owner', async () => {
    const foreign = await prisma.session.create({ data: { ownerId: 'other', title: 'Private other user', category: 'Spectrum' } });
    const response = await sessions.POST(request('/api/sessions', 'POST', { category: 'Spectrum' }, cookie));
    assert.equal(response.status, 201);
    const own = await response.json();
    const list = await (await sessions.GET(request('/api/sessions', 'GET', undefined, cookie))).json();
    assert.deepEqual(list.map((session: { id: string }) => session.id), [own.id]);
    assert.equal((await messages.GET(request(`/api/messages?sessionId=${foreign.id}`, 'GET', undefined, cookie))).status, 404);
    assert.equal((await sessions.DELETE(request(`/api/sessions?id=${foreign.id}`, 'DELETE', undefined, cookie))).status, 404);
    assert.ok(await prisma.session.findUnique({ where: { id: foreign.id } }));
  });
  await t.test('daily paid quota rejects excess requests atomically without consuming an hourly slot', async () => {
    process.env.DAILY_AI_REQUEST_LIMIT = '2';
    await enforceQuota('quota-test', 'chat');
    await enforceQuota('quota-test', 'chat');
    await assert.rejects(enforceQuota('quota-test', 'chat'), { status: 429 });
    const buckets = await prisma.usageBucket.findMany({ where: { id: { startsWith: 'quota-test:' } } });
    assert.equal(buckets.length, 2);
    assert.ok(buckets.every(bucket => bucket.count === 2));
    delete process.env.DAILY_AI_REQUEST_LIMIT;
  });
  await t.test('expired lease reclamation cannot be undone by the original request cleanup', async () => {
    const releaseOld = await acquireLease('lease-test');
    await assert.rejects(acquireLease('lease-test'), { status: 409 });
    await prisma.requestLease.update({ where: { id: 'lease-test' }, data: { expiresAt: new Date(Date.now() - 1) } });
    const releaseNew = await acquireLease('lease-test');
    await releaseOld();
    assert.ok(await prisma.requestLease.findUnique({ where: { id: 'lease-test' } }));
    await releaseNew();
    assert.equal(await prisma.requestLease.findUnique({ where: { id: 'lease-test' } }), null);
  });
  await t.test('logout revokes an otherwise valid signed cookie', async () => {
    assert.equal((await auth.DELETE(request('/api/auth', 'DELETE', undefined, cookie))).status, 200);
    assert.equal((await sessions.GET(request('/api/sessions', 'GET', undefined, cookie))).status, 401);
  });
  await t.test('production cannot silently fall back to password-free development settings', () => {
    const previous = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production', APP_ACCESS_PASSWORD: '' });
    try { assert.throws(() => authSettings(request('/api/auth')), { status: 503 }); }
    finally { Object.assign(process.env, { NODE_ENV: previous, APP_ACCESS_PASSWORD: 'test-only-password-123' }); }
  });
});
