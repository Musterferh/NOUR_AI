import type { ChatMessage, SourceReference } from '../types/frontend';

export type StreamEvent = { type: 'content'; content: string } | { type: 'sources'; sources: SourceReference[] } | { type: 'error'; message: string } | { type: 'done'; messageId?: string };

/** SSE frames may span network chunks and use LF or CRLF line endings. */
export function createEventDecoder() {
  let buffer = '';
  const readFrame = (frame: string): StreamEvent[] => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return [];
    if (data === '[DONE]') return [{ type: 'done' }];
    try {
      const value = JSON.parse(data);
      if (value.type === 'sources' && Array.isArray(value.sources)) return [{ type: 'sources', sources: value.sources }];
      if (value.type === 'error') return [{ type: 'error', message: typeof value.message === 'string' ? value.message : 'The response was interrupted. Please retry.' }];
      if (value.type === 'done') return [{ type: 'done', messageId: value.messageId }];
      const content = value.choices?.[0]?.delta?.content;
      return typeof content === 'string' && content ? [{ type: 'content', content }] : [];
    } catch {
      return [];
    }
  };
  return (chunk: string, final = false): StreamEvent[] => {
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, '\n');
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    if (final && buffer.trim()) { frames.push(buffer); buffer = ''; }
    return frames.flatMap(readFrame);
  };
}

export function updateMessage(messages: ChatMessage[], id: string, update: Partial<ChatMessage> | ((message: ChatMessage) => ChatMessage)): ChatMessage[] {
  return messages.map(message => message.id === id ? typeof update === 'function' ? update(message) : { ...message, ...update } : message);
}

export function remainingSeconds(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}
