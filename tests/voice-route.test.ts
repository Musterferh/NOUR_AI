import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('voice routes enforce private access, bounded inputs and safe provider handling', async t => {
  const databasePath = path.join(os.tmpdir(), `nour-voice-test-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
  process.env.APP_ACCESS_PASSWORD = 'test-only-password-123';
  process.env.AUTH_SECRET = 'test-only-secret-with-at-least-32-characters';
  process.env.OPENAI_API_KEY = 'mock-voice-provider-key';
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
  const speak = await import('../src/app/api/voice/speak/route');
  const transcribe = await import('../src/app/api/voice/transcribe/route');
  const { AUDIO_MAX_BYTES } = await import('../src/lib/voice');
  const login = await auth.POST(new Request('http://localhost/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.APP_ACCESS_PASSWORD }),
  }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const providerCalls: Array<{ url: string; body: BodyInit | null | undefined; signal: AbortSignal | null | undefined }> = [];
  let mode: 'normal' | 'error' | 'rate-limit' | 'waiting' = 'normal';
  let providerStarted: (() => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    providerCalls.push({ url, body: init?.body, signal: init?.signal });
    providerStarted?.();
    if (mode === 'waiting') {
      return new Promise<Response>((_resolve, reject) => {
        const stopped = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init?.signal?.aborted) stopped();
        else init?.signal?.addEventListener('abort', stopped, { once: true });
      });
    }
    if (mode === 'error' || mode === 'rate-limit') {
      return Response.json({ error: { message: 'SECRET_PROVIDER_DEBUG_BODY', type: 'provider_error' } }, { status: mode === 'rate-limit' ? 429 : 500 });
    }
    return url.endsWith('/audio/speech')
      ? new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })
      : Response.json({ text: 'Sannu. Explain spectrum assignment.' });
  });
  const speechRequest = (text: unknown, options: { authenticated?: boolean; signal?: AbortSignal; origin?: string } = {}) => new Request('http://localhost/api/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.authenticated === false ? {} : { Cookie: cookie }), ...(options.origin ? { Origin: options.origin } : {}) },
    body: JSON.stringify({ text }), signal: options.signal,
  });
  const audioRequest = (file: File | string = new File(['recorded audio'], 'recording.webm', { type: 'audio/webm' }), options: { authenticated?: boolean; signal?: AbortSignal } = {}) => {
    const form = new FormData();
    form.append('audio', file);
    return new Request('http://localhost/api/voice/transcribe', {
      method: 'POST', headers: options.authenticated === false ? {} : { Cookie: cookie }, body: form, signal: options.signal,
    });
  };

  await t.test('anonymous and cross-site requests never reach a paid provider', async () => {
    assert.equal((await speak.POST(speechRequest('Hello', { authenticated: false }))).status, 401);
    assert.equal((await transcribe.POST(audioRequest(undefined, { authenticated: false }))).status, 401);
    assert.equal((await speak.POST(speechRequest('Hello', { origin: 'https://attacker.invalid' }))).status, 403);
    assert.equal(providerCalls.length, 0);
  });

  await t.test('speech accepts only nonempty bounded text', async () => {
    for (const invalid of ['', '  ', 123, null, 'a'.repeat(4001)]) {
      assert.equal((await speak.POST(speechRequest(invalid))).status, 400);
    }
    assert.equal((await speak.POST(speechRequest('a'.repeat(20000)))).status, 413);
    assert.equal(providerCalls.length, 0);
  });

  await t.test('transcription checks multipart structure, file type, extension, nonempty content and size', async () => {
    assert.equal((await transcribe.POST(speechRequest('not multipart'))).status, 415);
    assert.equal((await transcribe.POST(audioRequest('not a file'))).status, 400);
    assert.equal((await transcribe.POST(audioRequest(new File([], 'empty.webm', { type: 'audio/webm' })))).status, 400);
    assert.equal((await transcribe.POST(audioRequest(new File(['audio'], 'recording.exe', { type: 'audio/webm' })))).status, 415);
    assert.equal((await transcribe.POST(audioRequest(new File(['audio'], 'recording.webm', { type: 'text/plain' })))).status, 415);
    assert.equal((await transcribe.POST(audioRequest(new File([new Uint8Array(AUDIO_MAX_BYTES + 1)], 'large.webm', { type: 'audio/webm' })))).status, 413);
    assert.equal(providerCalls.length, 0);
  });

  await t.test('valid speech returns private audio and transcription does not force an English-only language', async () => {
    const audio = await speak.POST(speechRequest('  Sannu, welcome.  '));
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal(audio.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [0x49, 0x44, 0x33, 1, 2, 3]);
    const payload = JSON.parse(String(providerCalls.at(-1)!.body));
    assert.equal(payload.input, 'Sannu, welcome.');
    const text = await transcribe.POST(audioRequest());
    assert.equal(text.status, 200);
    assert.equal((await text.json()).text, 'Sannu. Explain spectrum assignment.');
    const form = providerCalls.at(-1)!.body as FormData;
    assert.equal(form.get('model'), 'whisper-1');
    assert.equal(form.has('language'), false);
    assert.equal(await prisma.requestLease.count(), 0);
  });

  await t.test('upstream failures are sanitized, not retried silently, and release leases', async () => {
    mode = 'error';
    const before = providerCalls.length;
    const speech = await speak.POST(speechRequest('Hello'));
    assert.equal(speech.status, 502);
    assert.doesNotMatch(await speech.text(), /SECRET_PROVIDER_DEBUG_BODY|mock-voice-provider-key/);
    assert.equal(providerCalls.length, before + 1);
    const text = await transcribe.POST(audioRequest());
    assert.equal(text.status, 502);
    assert.doesNotMatch(await text.text(), /SECRET_PROVIDER_DEBUG_BODY/);
    mode = 'rate-limit';
    assert.equal((await speak.POST(speechRequest('Hello'))).status, 429);
    assert.equal(await prisma.requestLease.count(), 0);
    mode = 'normal';
  });

  await t.test('missing provider configuration produces a useful service error without making a request', async () => {
    const before = providerCalls.length;
    delete process.env.OPENAI_API_KEY;
    try { assert.equal((await speak.POST(speechRequest('Hello'))).status, 503); }
    finally { process.env.OPENAI_API_KEY = 'mock-voice-provider-key'; }
    assert.equal(providerCalls.length, before);
  });

  await t.test('canceling speech or transcription cancels upstream work and clears its lease', async () => {
    mode = 'waiting';
    for (const route of ['speech', 'transcription']) {
      const controller = new AbortController();
      const started = new Promise<void>(resolve => { providerStarted = resolve; });
      const pending = route === 'speech'
        ? speak.POST(speechRequest('Hello', { signal: controller.signal }))
        : transcribe.POST(audioRequest(undefined, { signal: controller.signal }));
      await started;
      controller.abort();
      const response = await pending;
      assert.equal(response.status, 408);
      assert.equal(providerCalls.at(-1)!.signal?.aborted, true);
      assert.equal(await prisma.requestLease.count(), 0);
    }
    providerStarted = undefined;
    mode = 'normal';
  });
});
