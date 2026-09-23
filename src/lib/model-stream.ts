import { HttpError } from './http';

/** Parse SSE by event boundaries, retaining partial UTF-8 and JSON across network chunks. */
export async function* modelDeltas(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  let truncated = false;
  const process = (event: string): string => {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return '';
    if (data.trim() === '[DONE]') { ended = true; return ''; }
    let parsed: { error?: unknown; choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string }> };
    try { parsed = JSON.parse(data); } catch { throw new HttpError(502, 'The coaching stream was interrupted. Please retry.'); }
    if (parsed.error) throw new HttpError(502, 'The coaching engine could not finish its response.');
    const choice = parsed.choices?.[0];
    // A finish_reason describes the answer; only [DONE] confirms that the
    // provider finished transmitting the stream (including trailing usage).
    if (choice?.finish_reason === 'length') truncated = true;
    return typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const value = process(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        if (value) yield value;
        if (ended) break;
      }
      if (ended) { buffer = ''; break; }
      if (buffer.length > 128_000) throw new HttpError(502, 'The coaching stream exceeded its limits.');
      if (done) break;
    }
    if (buffer.trim()) { const value = process(buffer); if (value) yield value; }
    if (!ended) throw new HttpError(502, 'The coaching response ended early. Please retry.');
    if (truncated) throw new HttpError(502, 'The response reached its length limit. Ask a narrower question or retry.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
