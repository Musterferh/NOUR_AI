'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson, errorMessage } from '@/lib/client-api';
import { createEventDecoder, updateMessage } from '@/lib/chat-state';
import type { ChatMessage } from '@/types/frontend';

interface Turn { id: string; text: string; userId: string; assistantId: string }

export function useChat(sessionId: string, onComplete?: (sessionId: string, text: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [failedTurn, setFailedTurn] = useState<Turn | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRequest = useRef<AbortController | null>(null);
  const generation = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    apiJson<ChatMessage[]>(`/api/messages?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal }, response => { if (!controller.signal.aborted) setNextCursor(response.headers.get('X-Next-Cursor')); })
      .then(data => {
        if (!Array.isArray(data)) throw new Error('Could not read this conversation. Please reload it.');
        if (controller.signal.aborted) return;
        setMessages(data);
        setReady(true);
        setError('');
        const last = data.at(-1);
        const user = last?.turnId ? data.find(message => message.role === 'user' && message.turnId === last.turnId) : undefined;
        if (last?.role === 'assistant' && ['failed', 'error', 'interrupted', 'stopped'].includes(last.status ?? '') && user && last.turnId) {
          setFailedTurn({ id: last.turnId, text: user.content, userId: user.id, assistantId: last.id });
          setError('The last response did not finish. You can retry it.');
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      mounted.current = false;
      controller.abort();
      generation.current?.abort();
      generation.current = null;
      olderRequest.current?.abort();
    };
  }, [sessionId, reloadKey]);

  const runTurn = useCallback(async (turn: Turn, retry: boolean): Promise<string | null> => {
    if (generation.current || loading) return null;
    const controller = new AbortController();
    generation.current = controller;
    setGenerating(true);
    setError('');
    setFailedTurn(null);
    setMessages(previous => retry
      ? updateMessage(previous, turn.assistantId, { content: '', sources: [], status: 'streaming' })
      : [...previous,
        { id: turn.userId, role: 'user', content: turn.text, turnId: turn.id },
        { id: turn.assistantId, role: 'assistant', content: '', status: 'streaming', turnId: turn.id }]);
    let fullText = '';
    let completed = false;
    let serverMessageId: string | undefined;
    const isCurrent = () => mounted.current && generation.current === controller && !controller.signal.aborted;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ message: turn.text, sessionId, turnId: turn.id }), signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === 'string' ? data.error : `Could not send your message (${response.status}).`);
      }
      if (!response.body) throw new Error('The server returned an empty response. Please retry.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const readEvents = createEventDecoder();
      const consume = (text: string, final = false) => {
        for (const event of readEvents(text, final)) {
          if (!isCurrent()) return;
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'content') {
            fullText += event.content;
            setMessages(previous => updateMessage(previous, turn.assistantId, message => ({ ...message, content: message.content + event.content })));
          }
          if (event.type === 'sources') setMessages(previous => updateMessage(previous, turn.assistantId, { sources: event.sources }));
          if (event.type === 'done') { completed = true; serverMessageId = event.messageId ?? serverMessageId; }
        }
      };
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          consume(decoder.decode(chunk.value, { stream: true }));
        }
        consume(decoder.decode(), true);
      } finally { reader.releaseLock(); }
      if (!isCurrent()) return null;
      if (!completed || !fullText.trim()) throw new Error('The response ended early. Retry to finish this answer.');
      setMessages(previous => updateMessage(previous, turn.assistantId, { status: 'complete', ...(serverMessageId ? { id: serverMessageId } : {}) }));
      onComplete?.(sessionId, turn.text);
      return fullText;
    } catch (reason) {
      if (mounted.current && generation.current === controller) {
        setMessages(previous => updateMessage(previous, turn.assistantId, { status: controller.signal.aborted ? 'interrupted' : 'failed' }));
        setError(controller.signal.aborted ? 'Response stopped. You can retry this message.' : errorMessage(reason));
        setFailedTurn(turn);
      }
      return null;
    } finally {
      if (mounted.current && generation.current === controller) {
        generation.current = null;
        setGenerating(false);
      }
    }
  }, [sessionId, loading, onComplete]);

  const send = useCallback((text: string) => {
    if (!text.trim()) return Promise.resolve(null);
    const id = crypto.randomUUID();
    return runTurn({ id, text: text.trim(), userId: `user-${id}`, assistantId: `assistant-${id}` }, false);
  }, [runTurn]);

  const loadOlder = async () => {
    if (!nextCursor || olderRequest.current) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    setLoadingOlder(true);
    try {
      const previous = await apiJson<ChatMessage[]>(`/api/messages?sessionId=${encodeURIComponent(sessionId)}&cursor=${encodeURIComponent(nextCursor)}`, { signal: controller.signal }, response => { if (!controller.signal.aborted) setNextCursor(response.headers.get('X-Next-Cursor')); });
      if (!Array.isArray(previous)) throw new Error('Older messages could not be loaded.');
      if (!controller.signal.aborted) setMessages(values => [...previous.filter(message => !values.some(value => value.id === message.id)), ...values]);
    } catch (reason) { if (!controller.signal.aborted) setError(errorMessage(reason)); }
    finally { if (!controller.signal.aborted) setLoadingOlder(false); olderRequest.current = null; }
  };

  return {
    messages, loading, ready, generating, error, failedTurn, send, loadOlder, loadingOlder, hasOlder: Boolean(nextCursor),
    retry: () => failedTurn ? runTurn(failedTurn, true) : Promise.resolve(null),
    stop: () => generation.current?.abort(),
    reload: () => { setLoading(true); setReloadKey(value => value + 1); },
  };
}
