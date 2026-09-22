import { HttpError } from './http';

export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
export interface KimiOptions { signal?: AbortSignal; maxTokens?: number }
export class ModelOutputError extends HttpError {
  constructor() { super(502, 'The coach returned an invalid response. Please try again.'); this.name = 'ModelOutputError'; }
}

function kimiConfiguration() {
  const key = process.env.KIMI_API_KEY?.trim();
  if (!key || key.startsWith('your_')) throw new HttpError(503, 'The coaching engine is not configured. Set KIMI_API_KEY on the server.');
  const url = process.env.KIMI_BASE_URL?.trim() || 'https://api.moonshot.ai/v1/chat/completions';
  let configured: URL;
  try { configured = new URL(url); } catch { throw new HttpError(503, 'KIMI_BASE_URL must be a valid coaching engine URL.'); }
  const localHttp = configured.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname);
  if (configured.protocol !== 'https:' && !localHttp) throw new HttpError(503, 'The coaching engine requires a secure connection.');
  return { key, url };
}

export function assertKimiConfigured() { kimiConfiguration(); }

export function getKimiSetupStatus(): { configured: boolean; message?: string } {
  try {
    assertKimiConfigured();
    return { configured: true };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { configured: false, message: error.message };
  }
}

async function requestModel(messages: Message[], stream: boolean, options: KimiOptions) {
  const { key, url } = kimiConfiguration();
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal,
      body: JSON.stringify({ model: process.env.KIMI_MODEL || 'moonshot-v1-128k', messages, stream, temperature: stream ? 0.3 : 0.2, max_tokens: Math.min(options.maxTokens || (stream ? 2200 : 12000), 14000) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new HttpError(499, 'The request was stopped.');
    if (signal.aborted) throw new HttpError(504, 'The coaching engine took too long. Please retry.');
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? 'The coaching engine is busy. Please wait and retry.' : 'The coaching engine could not respond. Check its configuration or retry.');
  }
  return response;
}

export async function callKimiStream(messages: Message[], options: KimiOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const response = await requestModel(messages, true, options);
  if (!response.body) throw new ModelOutputError();
  return response.body;
}

export async function callKimiJson(messages: Message[], options: KimiOptions = {}): Promise<unknown> {
  const response = await requestModel(messages, false, options);
  let data: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
  try { data = await response.json(); } catch { throw new ModelOutputError(); }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || data.choices?.[0]?.finish_reason === 'length') throw new ModelOutputError();
  const cleaned = content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new ModelOutputError(); }
}
