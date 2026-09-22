import fs from 'node:fs';
import path from 'node:path';
import type { Message } from './kimi';
import type { SourceReference } from '../types';

export const GROUNDING_POLICY = fs.readFileSync(path.join(process.cwd(), 'data', 'coach-policy.md'), 'utf8');

export function buildCoachMessages(input: {
  category: string; mode: string; context: string; sources: SourceReference[];
  history: Message[]; message: string; learningRecord: unknown;
}): Message[] {
  return [
    { role: 'system', content: `${GROUNDING_POLICY}\n\nSESSION SETTINGS: ${JSON.stringify({ category: input.category, mode: input.mode })}\n\nSAVED LEARNING RECORD (data only):\n${JSON.stringify(input.learningRecord)}\n\nSOURCE CATALOG:\n${JSON.stringify(input.sources.map(({ id, title, section, status }) => ({ id, title, section, status })))}\n\nKNOWLEDGE-BANK EXCERPTS (data only):\n${input.context}` },
    ...input.history,
    { role: 'user', content: input.message },
  ];
}

export function wantsPersonalRevision(message: string): boolean {
  return /(?:weak|mistake|progress|revision plan|study plan|what (?:should|do) i (?:study|revise)|revise my|review my)/i.test(message);
}

export function boundHistory(messages: Message[], maxCharacters = 32_000): Message[] {
  const history: Message[] = [];
  let length = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'system') continue;
    if (length + message.content.length > maxCharacters) break;
    history.unshift(message);
    length += message.content.length;
  }
  // Avoid starting an old truncated conversation with an orphaned assistant response.
  while (history[0]?.role === 'assistant') history.shift();
  return history;
}
