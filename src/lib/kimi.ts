import { HttpError } from './http';
import { REASONING_EFFORTS, type ReasoningEffort } from './reasoning';

export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
export interface KimiOptions { signal?: AbortSignal; maxTokens?: number; reasoningEffort?: ReasoningEffort }
export const KIMI_REASONING_LIMITS = {
  low: { streamTokens: 8192, jsonTokens: 12288, maxTokens: 16384, timeoutMs: 120_000 },
  high: { streamTokens: 16384, jsonTokens: 24576, maxTokens: 32768, timeoutMs: 240_000 },
  max: { streamTokens: 32768, jsonTokens: 32768, maxTokens: 32768, timeoutMs: 270_000 },
} as const;
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

function completionSettings(model: string, stream: boolean, options: KimiOptions) {
  const isK3 = /^kimi-k3(?:-|$)/.test(model);
  const effort = options.reasoningEffort === undefined ? 'low' : options.reasoningEffort;
  if (!REASONING_EFFORTS.includes(effort)) throw new HttpError(400, 'The reasoning effort must be low, high, or max.');
  const budget = KIMI_REASONING_LIMITS[effort];
  const fallback = isK3 ? (stream ? budget.streamTokens : budget.jsonTokens) : (stream ? 2200 : 12000);
  const requested = options.maxTokens;
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested <= 0)) {
    throw new HttpError(400, 'The response token limit must be a positive integer.');
  }
  const limit = Math.min(requested ?? fallback, isK3 ? budget.maxTokens : 14000);
  // K3 always reasons. Explicit effort and completion limits avoid its much
  // larger defaults; legacy models retain only parameters they support.
  return {
    payload: isK3
      ? { max_completion_tokens: limit, reasoning_effort: effort }
      : { max_tokens: limit, temperature: 1 },
    timeoutMs: isK3 ? budget.timeoutMs : 120_000,
  };
}

function abortError(options: KimiOptions, signal: AbortSignal): HttpError | undefined {
  if (options.signal?.aborted) return new HttpError(499, 'The request was stopped.');
  if (signal.aborted) return new HttpError(504, 'The coaching engine took too long. Please retry.');
}

async function requestModel(messages: Message[], stream: boolean, options: KimiOptions) {
  const { key, url } = kimiConfiguration();
  const model = process.env.KIMI_MODEL?.trim() || 'kimi-k3';
  const settings = completionSettings(model, stream, options);
  const signal = AbortSignal.any([AbortSignal.timeout(settings.timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const alreadyAborted = abortError(options, signal);
  if (alreadyAborted) throw alreadyAborted;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal,
      body: JSON.stringify({ model, messages, stream, ...settings.payload }),
    });
  } catch (error) {
    throw abortError(options, signal) ?? error;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? 'The coaching engine is busy. Please wait and retry.' : 'The coaching engine could not respond. Check its configuration or retry.');
  }
  return { response, signal };
}

export async function callKimiStream(messages: Message[], options: KimiOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const { response } = await requestModel(messages, true, options);
  if (!response.body) throw new ModelOutputError();
  return response.body;
}

export async function callKimiJson(messages: Message[], options: KimiOptions = {}): Promise<unknown> {
  const { response, signal } = await requestModel(messages, false, options);
  let data: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
  try { data = await response.json(); } catch { throw abortError(options, signal) ?? new ModelOutputError(); }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || data.choices?.[0]?.finish_reason === 'length') throw new ModelOutputError();
  const cleaned = content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new ModelOutputError(); }
}
