import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'HttpError'; }
}

export async function readBoundedBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const size = Number(req.headers.get('content-length') || 0);
  if (size > maxBytes) throw new HttpError(413, 'The request is too large.');
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'The request is too large.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.length; }
  return body;
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T, maxBytes = 64 * 1024): Promise<z.infer<T>> {
  if (!req.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Send an application/json request.');
  const body = await readBoundedBody(req, maxBytes);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new HttpError(400, 'The request contains invalid JSON.'); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid request.');
  return parsed.data;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function apiError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: 'Invalid request.' }, 400);
  if (error instanceof Error && 'code' in error && error.code === 'KNOWLEDGE_BASE_UNAVAILABLE') {
    return json({ error: 'The knowledge bank is unavailable. Restore it before continuing.' }, 503);
  }
  // Log only error categories, never user transcripts, provider bodies or credentials.
  console.error('Request failed:', error);
  return json({ error: error instanceof Error ? error.message : 'This request could not be completed. Please try again.' }, 500);
}
