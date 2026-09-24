import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EXAM_DURATION_MS, EXAM_QUESTION_COUNT } from '../src/lib/exams';

test('exam generation rejects setup failures without consuming paid quota and starts configured exams', async t => {
  const workspace = process.cwd();
  const databasePath = path.join(os.tmpdir(), `nour-exam-generation-test-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
  process.env.APP_ACCESS_PASSWORD = 'test-only-password-123';
  process.env.AUTH_SECRET = 'test-only-secret-with-at-least-32-characters';
  process.env.KIMI_BASE_URL = 'http://localhost/mock-provider';
  process.env.KIMI_API_KEY = 'mock-exam-provider-key';
  const { prisma } = await import('../src/lib/prisma');
  t.after(async () => {
    process.chdir(workspace);
    await prisma.$disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) await fs.rm(`${databasePath}${suffix}`, { force: true });
  });
  for (const file of ['001_initial.sql', '002_private_learning.sql']) {
    const sql = await fs.readFile(path.join(workspace, 'prisma', 'migrations', file), 'utf8');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
  }
  const auth = await import('../src/app/api/auth/route');
  const { POST } = await import('../src/app/api/exam/generate/route');
  const login = await auth.POST(new Request('http://localhost/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.APP_ACCESS_PASSWORD }),
  }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const request = () => new Request('http://localhost/api/exam/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ category: 'NCA 2003' }),
  });
  let providerCalls = 0;
  let sentAuthorization: string | null = null;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls++;
    sentAuthorization = new Headers(init?.headers).get('Authorization');
    const payload = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }>; reasoning_effort: string; max_completion_tokens: number };
    assert.equal(payload.reasoning_effort, 'high');
    assert.equal(payload.max_completion_tokens, 24576);
    const grounding = JSON.parse(payload.messages.find(message => message.role === 'user')!.content) as { sources: Array<{ id: string }> };
    assert.ok(grounding.sources.length);
    const questions = Array.from({ length: EXAM_QUESTION_COUNT }, (_, index) => ({
      question: `Which rule governs practice scenario number ${index + 1}?`, topic: 'NCA 2003',
      options: { A: 'The statutory rule', B: 'An informal suggestion', C: 'A draft consultation', D: 'A historical announcement' },
      correctAnswer: 'A', explanation: '[VERIFY] The supplied knowledge bank identifies the statutory rule.',
      sourceIds: [grounding.sources[index % grounding.sources.length].id],
    }));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(questions) } }] });
  });
  async function assertNoGenerationWrites(expectedLeases = 0) {
    assert.equal(providerCalls, 0);
    assert.equal(await prisma.examAttempt.count(), 0);
    assert.equal(await prisma.usageBucket.count({ where: { OR: [
      { id: { startsWith: 'private:exam:' } }, { id: { startsWith: 'private:paid:' } },
    ] } }), 0);
    assert.equal(await prisma.requestLease.count(), expectedLeases);
  }

  await t.test('a missing knowledge bank fails before charging an exam or paid request', async () => {
    // The policy module was loaded from the real workspace above. An empty cwd
    // simulates missing retrieval data without changing any project source file.
    const emptyWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nour-missing-corpus-test-'));
    try {
      process.chdir(emptyWorkspace);
      const response = await POST(request());
      assert.equal(response.status, 503);
      await assertNoGenerationWrites();
    } finally {
      process.chdir(workspace);
      await fs.rmdir(emptyWorkspace);
    }
  });

  for (const [label, key] of [
    ['missing', undefined], ['empty', ''], ['blank', '   '],
    ['placeholder', 'your_api_key_here'], ['padded placeholder', '  your_api_key_here  '],
  ] as const) {
    await t.test(`${label} provider key returns setup guidance without consuming quota`, async () => {
      if (key === undefined) delete process.env.KIMI_API_KEY;
      else process.env.KIMI_API_KEY = key;
      const response = await POST(request());
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.match(body.error, /KIMI_API_KEY/);
      await assertNoGenerationWrites();
    });
  }
  process.env.KIMI_API_KEY = 'mock-exam-provider-key';

  await t.test('setup status stays private and invalid model configuration does not prevent login', async () => {
    process.env.KIMI_API_KEY = 'your_private_placeholder';
    try {
      const anonymous = await (await auth.GET(new Request('http://localhost/api/auth'))).json();
      assert.equal(anonymous.authenticated, false);
      assert.equal('coaching' in anonymous, false);
      const signedIn = await (await auth.GET(new Request('http://localhost/api/auth', { headers: { Cookie: cookie } }))).json();
      assert.equal(signedIn.authenticated, true);
      assert.equal(signedIn.coaching.configured, false);
      assert.match(signedIn.coaching.message, /KIMI_API_KEY/);
      assert.doesNotMatch(JSON.stringify(signedIn), /your_private_placeholder/);
      const relogin = await auth.POST(new Request('http://localhost/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: process.env.APP_ACCESS_PASSWORD }),
      }));
      assert.equal(relogin.status, 200);
      await assertNoGenerationWrites();
    } finally { process.env.KIMI_API_KEY = 'mock-exam-provider-key'; }
  });

  await t.test('an invalid provider URL fails before consuming quota', async () => {
    process.env.KIMI_BASE_URL = 'not-a-valid-url';
    try {
      assert.equal((await POST(request())).status, 503);
      await assertNoGenerationWrites();
    } finally { process.env.KIMI_BASE_URL = 'http://localhost/mock-provider'; }
  });

  await t.test('an existing generation lease rejects a duplicate start without charging it', async () => {
    await prisma.requestLease.create({ data: { id: 'private:exam-generation', token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    try {
      assert.equal((await POST(request())).status, 409);
      await assertNoGenerationWrites(1);
    } finally { await prisma.requestLease.deleteMany({ where: { id: 'private:exam-generation' } }); }
  });

  await t.test('a configured generation stores an attempt and returns questions without its answer key', async () => {
    process.env.KIMI_API_KEY = '  mock-exam-provider-key  ';
    const response = await POST(request());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const attempt = await response.json();
    assert.equal(attempt.questions.length, EXAM_QUESTION_COUNT);
    assert.equal(new Set(attempt.questions.map((question: { id: string }) => question.id)).size, EXAM_QUESTION_COUNT);
    assert.deepEqual(attempt.answers, {});
    assert.equal(attempt.revision, 0);
    assert.equal(attempt.submittedAt, null);
    assert.equal(Date.parse(attempt.expiresAt) - Date.parse(attempt.startedAt), EXAM_DURATION_MS);
    for (const question of attempt.questions) {
      assert.equal('correctAnswer' in question, false);
      assert.equal('explanation' in question, false);
      assert.ok(question.sourceIds.every((id: string) => attempt.sources.some((source: { id: string }) => source.id === id)));
    }
    const saved = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(JSON.parse(saved.questions)[0].correctAnswer, 'A');
    assert.equal(await prisma.requestLease.count(), 0);
    assert.equal(providerCalls, 1);
    assert.equal(sentAuthorization, 'Bearer mock-exam-provider-key');
    const usage = await prisma.usageBucket.findMany({ where: { OR: [
      { id: { startsWith: 'private:exam:' } }, { id: { startsWith: 'private:paid:' } },
    ] } });
    assert.equal(usage.length, 2);
    assert.ok(usage.every(bucket => bucket.count === 1));
  });
});
