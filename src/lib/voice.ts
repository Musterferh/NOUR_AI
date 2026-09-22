import OpenAI from 'openai';
import { HttpError } from './http';

export function voiceClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) throw new HttpError(503, 'Voice is not configured. Set OPENAI_API_KEY on the server.');
  return new OpenAI({ apiKey, timeout: 45_000, maxRetries: 0 });
}

export function voiceError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  // SDK abort/timeout errors inherit APIError, so classify them before provider failures.
  if (error instanceof OpenAI.APIUserAbortError || error instanceof OpenAI.APIConnectionTimeoutError) return new HttpError(408, 'Voice processing was stopped or timed out.');
  if (error instanceof OpenAI.APIError) return new HttpError(error.status === 429 ? 429 : 502, error.status === 429 ? 'Voice is busy. Please wait and retry.' : 'Voice processing could not finish. Please try again.');
  if (error instanceof Error && /abort|timeout/i.test(error.name)) return new HttpError(408, 'Voice processing was stopped or timed out.');
  return error;
}

export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;
export const AUDIO_TYPES = new Set(['audio/webm', 'video/webm', 'audio/mp4', 'video/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/mp3', 'audio/mpga', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac']);
