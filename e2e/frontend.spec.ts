import { test, expect, type Page, type Route } from '@playwright/test';

const sessions = [
  { id: 'session-a', title: 'Law conversation', category: 'NCA 2003', mode: 'Mode 1 (Teach)' },
  { id: 'session-b', title: 'Spectrum conversation', category: 'Spectrum', mode: 'Mode 2 (Drill/Quiz)' },
];
const answer = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"type":"done","messageId":"saved-answer"}\n\n`;

async function mockStudy(page: Page) {
  await page.route('**/api/auth', route => route.fulfill({ json: { authenticated: true, requiresPassword: true } }));
  await page.route('**/api/sessions*', route => route.fulfill({ json: sessions }));
  await page.route('**/api/messages?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('sessionId') === 'session-b' ? [{ id: 'b-message', role: 'assistant', content: 'Spectrum history stays here.' }] : [] }));
  await page.route('**/api/exam/attempt*', route => route.fulfill({ json: null }));
  await page.route('**/api/progress', route => route.fulfill({ json: { attempts: [], mistakes: [], weakTopics: [], recommendedTopics: [] } }));
}

test('password login protects the study UI and reports incorrect passwords', async ({ page }) => {
  await mockStudy(page);
  let authenticated = false;
  await page.route('**/api/auth', async route => {
    if (route.request().method() === 'POST') {
      authenticated = route.request().postDataJSON().password === 'correct-test-password';
      await route.fulfill(authenticated ? { json: { authenticated: true } } : { status: 401, json: { error: 'Incorrect password.' } });
    } else await route.fulfill({ json: { authenticated, requiresPassword: true } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Study space password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'My progress' })).toHaveCount(0);
  await page.getByLabel('Study space password').fill('wrong');
  await page.getByRole('button', { name: 'Enter my study space' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect password' })).toBeVisible();
  await page.getByLabel('Study space password').fill('correct-test-password');
  await page.getByRole('button', { name: 'Enter my study space' }).click();
  await expect(page.getByLabel('Message NOUR')).toBeEnabled();
});

test('switching sessions cancels an active stream and isolates its message state', async ({ page }) => {
  await mockStudy(page);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    Object.assign(window, { __chatAborted: false });
    window.fetch = async (input, init) => {
      if (String(input) !== '/api/chat') return original(input, init);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Session A partial"}}]}\n\n'));
        init?.signal?.addEventListener('abort', () => { Object.assign(window, { __chatAborted: true }); controller.error(new DOMException('Aborted', 'AbortError')); });
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  await page.getByLabel('Message NOUR').fill('Question in A');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Session A partial', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Spectrum conversation Spectrum', exact: true }).click();
  await expect(page.getByText('Spectrum history stays here.')).toBeVisible();
  await expect(page.getByText('Session A partial', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Message NOUR')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chatAborted: boolean }).__chatAborted)).toBe(true);
  await expect(page.getByLabel('Study topic')).toHaveValue('Spectrum');
});

test('a session history HTTP failure remains recoverable without crashing', async ({ page }) => {
  await mockStudy(page);
  let broken = true;
  await page.route('**/api/messages?*', route => route.fulfill(broken ? { status: 500, json: { error: 'History temporarily unavailable.' } } : { json: [] }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'History temporarily unavailable' })).toBeVisible();
  await expect(page.getByLabel('Message NOUR')).toBeDisabled();
  broken = false;
  await page.getByRole('button', { name: 'Reload conversation', exact: true }).click();
  await expect(page.getByLabel('Message NOUR')).toBeEnabled();
});

test('retrying a failed answer reuses its turn ID and does not duplicate messages', async ({ page }) => {
  await mockStudy(page);
  const turns: string[] = [];
  await page.route('**/api/chat', route => {
    turns.push(route.request().postDataJSON().turnId);
    return route.fulfill(turns.length === 1 ? { status: 503, json: { error: 'Please retry this answer.' } } : { contentType: 'text/event-stream', body: answer('Recovered answer') });
  });
  await page.goto('/');
  await page.getByLabel('Message NOUR').fill('My retry question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: 'Retry answer' }).click();
  await expect(page.getByText('Recovered answer', { exact: true })).toBeVisible();
  expect(turns).toHaveLength(2);
  expect(turns[0]).toBe(turns[1]);
  await expect(page.getByText('My retry question', { exact: true })).toHaveCount(1);
});

async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { __micStops: 0 });
    const stream = { getTracks: () => [{ stop: () => { const value = (window as unknown as { __micStops: number }).__micStops; Object.assign(window, { __micStops: value + 1 }); } }] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    class Recorder {
      static isTypeSupported() { return true; }
      mimeType = 'audio/webm'; state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }); }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class { constructor() { throw new Error('Manual recording test'); } } });
  });
}

test('ending voice and navigating away stop microphone tracks without uploading audio', async ({ page }) => {
  await mockStudy(page);
  await fakeMicrophone(page);
  const uploads: string[] = [];
  await page.route('**/api/voice/transcribe', route => { uploads.push('upload'); return route.fulfill({ json: { text: 'Unexpected recording' } }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start voice conversation' }).click();
  await expect(page.getByText('Listening to you…')).toBeVisible();
  await page.getByRole('button', { name: 'End voice', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __micStops: number }).__micStops)).toBe(1);
  await page.getByRole('button', { name: 'Start voice conversation' }).click();
  await expect(page.getByText('Listening to you…')).toBeVisible();
  await page.getByRole('button', { name: 'Exam simulator', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start exam', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __micStops: number }).__micStops)).toBe(2);
  expect(uploads).toHaveLength(0);
});

const exam = () => ({
  id: 'exam-a', category: 'NCA 2003', revision: 0, sources: [],
  startedAt: '2030-01-01T12:00:00.000Z', expiresAt: '2030-01-01T12:30:00.000Z', submittedAt: null as string | null,
  answers: {} as Record<string, string>,
  questions: [1, 2].map(id => ({ id: `q${id}`, question: `Practice question ${id}?`, topic: 'Governance', options: { A: 'First choice', B: 'Second choice', C: 'Third choice', D: 'Fourth choice' }, sourceIds: [], correctAnswer: 'A', explanation: 'Explanation from the study material.' })),
});

const generatedExam = () => {
  const attempt = exam();
  const template = attempt.questions[0];
  return {
    ...attempt,
    questions: Array.from({ length: 20 }, (_, index) => ({
      id: `generated-q${index + 1}`,
      question: `Generated practice question ${index + 1}?`,
      topic: template.topic,
      options: template.options,
      sourceIds: template.sourceIds,
    })),
  };
};

test('Start exam explains missing setup and becomes usable after refreshing corrected configuration', async ({ page }) => {
  await mockStudy(page);
  await page.clock.install({ time: new Date('2030-01-01T11:59:00.000Z') });
  await page.clock.pauseAt(new Date('2030-01-01T12:00:00.000Z'));
  let configured = false;
  let generationRequests = 0;
  await page.route('**/api/auth', route => route.fulfill({
    json: {
      authenticated: true,
      requiresPassword: true,
      coaching: { configured, message: configured ? undefined : 'Set KIMI_API_KEY to enable the coaching engine.' },
    },
  }));
  await page.route('**/api/exam/generate', route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON().category).toBe('NCA 2003');
    generationRequests += 1;
    return route.fulfill({ status: 201, json: generatedExam() });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Exam simulator', exact: true }).click();
  const setupAlert = page.getByRole('alert').filter({ hasText: 'Exam setup needed' });
  await expect(setupAlert).toBeVisible();
  await expect(setupAlert).toContainText('Set KIMI_API_KEY');
  await expect(setupAlert).toContainText('.env.local');
  await expect(setupAlert).toContainText('restart the app');
  await expect(page.getByRole('button', { name: 'Start exam', exact: true })).toBeDisabled();
  expect(generationRequests).toBe(0);

  configured = true;
  await page.getByRole('button', { name: 'Refresh setup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start exam', exact: true })).toBeEnabled();
  await expect(setupAlert).toHaveCount(0);
  expect(generationRequests).toBe(0);
  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.getByText('Generated practice question 1?', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1 of 20', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('30:00');
  expect(generationRequests).toBe(1);
});

test('Start exam shows generation failures beside the button and retries successfully', async ({ page }) => {
  await mockStudy(page);
  await page.clock.install({ time: new Date('2030-01-01T11:59:00.000Z') });
  await page.clock.pauseAt(new Date('2030-01-01T12:00:00.000Z'));
  await page.route('**/api/auth', route => route.fulfill({ json: { authenticated: true, requiresPassword: true, coaching: { configured: true } } }));
  const failureMessage = 'The coaching engine is temporarily unavailable. Please try again.';
  let generationRequests = 0;
  await page.route('**/api/exam/generate', route => {
    expect(route.request().method()).toBe('POST');
    generationRequests += 1;
    return route.fulfill(generationRequests === 1
      ? { status: 503, json: { error: failureMessage } }
      : { status: 201, json: generatedExam() });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Exam simulator', exact: true }).click();
  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.locator('.exam-intro').getByRole('alert')).toHaveText(failureMessage);
  await expect(page.locator('.exam-intro').getByRole('button', { name: 'Start exam', exact: true })).toBeEnabled();
  await expect(page.getByRole('timer')).toHaveCount(0);
  expect(generationRequests).toBe(1);

  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.getByText('Generated practice question 1?', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1 of 20', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('30:00');
  await expect(page.getByRole('alert').filter({ hasText: failureMessage })).toHaveCount(0);
  expect(generationRequests).toBe(2);
});

test('an exam resumes saved answers and expires against its original deadline after a time jump', async ({ page }) => {
  await mockStudy(page);
  await page.clock.install({ time: new Date('2030-01-01T12:19:00.000Z') });
  await page.clock.pauseAt(new Date('2030-01-01T12:20:00.000Z'));
  const attempt = { ...exam(), answers: { q1: 'A' } };
  await page.route('**/api/exam/attempt*', route => route.fulfill({ json: attempt }));
  await page.route('**/api/exam/submit', route => route.fulfill({ json: { ...attempt, submittedAt: '2030-01-01T12:30:00.000Z', score: 50, revision: 1 } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Exam simulator', exact: true }).click();
  await expect(page.getByRole('timer')).toHaveText('10:00');
  await expect(page.getByRole('radio', { name: 'A First choice' })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('timer')).toHaveText('10:00');
  await expect(page.getByRole('radio', { name: 'A First choice' })).toBeChecked();
  await page.clock.fastForward(10 * 60 * 1000);
  await expect(page.getByRole('heading', { name: 'Exam review', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '50%', exact: true })).toBeVisible();
});

test('exam submission waits for every queued answer save and keeps the submitted result', async ({ page }) => {
  await mockStudy(page);
  await page.clock.install({ time: new Date('2030-01-01T12:20:00.000Z') });
  const attempt = exam();
  const saves: Route[] = [];
  let submits = 0;
  await page.route('**/api/exam/attempt*', route => {
    if (route.request().method() === 'PATCH') { saves.push(route); return; }
    return route.fulfill({ json: attempt });
  });
  await page.route('**/api/exam/submit', route => { submits += 1; return route.fulfill({ json: { ...attempt, answers: { q1: 'A', q2: 'B' }, submittedAt: '2030-01-01T12:21:00.000Z', score: 50, revision: 3 } }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Exam simulator', exact: true }).click();
  await page.getByRole('radio', { name: 'A First choice' }).check();
  await expect.poll(() => saves.length).toBe(1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'B Second choice' }).check();
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm submission', exact: true }).click();
  expect(submits).toBe(0);
  await saves[0].fulfill({ json: { ...attempt, answers: { q1: 'A' }, revision: 1 } });
  await expect.poll(() => saves.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Submitting…', exact: true })).toBeVisible();
  expect(submits).toBe(0);
  await saves[1].fulfill({ json: { ...attempt, answers: { q1: 'A', q2: 'B' }, revision: 2 } });
  await expect(page.getByRole('heading', { name: 'Exam review', exact: true })).toBeVisible();
  expect(submits).toBe(1);
});

test('resizing an open mobile navigation restores desktop keyboard access', async ({ page }) => {
  await mockStudy(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Message NOUR')).toBeEnabled();
  await page.screenshot({ path: 'test-results/frontend-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.main-pane')).toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.main-pane')).not.toHaveAttribute('inert', '');
  await page.getByLabel('Message NOUR').focus();
  await expect(page.getByLabel('Message NOUR')).toBeFocused();
  await page.getByLabel('Message NOUR').fill('Keyboard access restored');
  await page.screenshot({ path: 'test-results/frontend-desktop.png', fullPage: true });
});
