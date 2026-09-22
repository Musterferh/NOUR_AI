'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Check, Copy, Menu, Mic, Send, Square, Volume2 } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import type { StudySession } from '@/types/frontend';
import Sources from './Sources';

export default function ChatInterface({ session, toggleSidebar, onComplete }: { session: StudySession; toggleSidebar: () => void; onComplete: (sessionId: string, text: string) => void }) {
  const chat = useChat(session.id, onComplete);
  const voice = useVoiceSession(chat.send, chat.stop);
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [chat.messages, chat.generating]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const send = () => {
    if (!input.trim() || chat.generating || chat.loading || !chat.ready || voice.active) return;
    const text = input;
    setInput('');
    follow.current = true;
    void chat.send(text);
    inputRef.current?.focus();
  };
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id); setCopyError('');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch { setCopyError('Copy failed. You can select and copy the answer text.'); }
  };

  return <section className="workspace chat-workspace" aria-label="Study conversation">
    <header className="workspace-header">
      <div className="header-heading"><button className="icon-button mobile-menu" onClick={toggleSidebar} aria-label="Open navigation"><Menu size={20} /></button><div><p className="eyebrow">YOUR STUDY COACH</p><h1>{session.category}</h1></div></div>
      <span className="mode-badge">{session.mode === 'Mode 2 (Drill/Quiz)' ? 'Drill & quiz' : 'Teach'}</span>
    </header>
    <div ref={feed} className="message-feed" onScroll={() => { const element = feed.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }} aria-busy={chat.loading}>
      {chat.hasOlder && <div className="load-older"><button className="text-button" disabled={chat.loadingOlder} onClick={() => { follow.current = false; void chat.loadOlder(); }}>{chat.loadingOlder ? 'Loading…' : 'Load earlier messages'}</button></div>}
      {chat.loading ? <p className="empty-note" role="status">Loading your conversation…</p> : chat.messages.length === 0 && chat.ready ? <div className="chat-welcome">
        <div className="brand-orb"><BookOpen size={32} strokeWidth={1.4} /></div>
        <p className="eyebrow">PREPARE WITH PURPOSE</p><h2>Master your<br /><span>next chapter.</span></h2>
        <p>Your NCC promotion study coach. Ask a question about {session.category}, explore a source, or work through a quiz.</p>
      </div> : <div className="message-list">{chat.messages.map(message => <article key={message.id} className={`message message-${message.role}`} aria-label={message.role === 'user' ? 'Your message' : 'NOUR response'}>
        <p className="message-label">{message.role === 'user' ? 'YOU' : 'NOUR'}</p>
        <div className="message-body">{message.role === 'assistant' ? <div className="prose max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.status === 'streaming' ? 'Thinking…' : 'This answer did not finish.')}</ReactMarkdown></div> : <p className="user-text">{message.content}</p>}</div>
        {message.role === 'assistant' && <><Sources sources={message.sources} /><div className="message-actions">
          <button className="text-button" onClick={() => void copy(message.id, message.content)} disabled={!message.content} aria-label={copied === message.id ? 'Answer copied' : 'Copy answer'}>{copied === message.id ? <Check size={14} /> : <Copy size={14} />} {copied === message.id ? 'Copied' : 'Copy'}</button>
          {['failed', 'error', 'interrupted', 'stopped'].includes(message.status ?? '') && <span className="muted">Incomplete response</span>}
        </div></>}
      </article>)}</div>}
    </div>
    <div className="composer-wrap">
      <div role="status" aria-live="polite" className="sr-only">{chat.generating ? 'NOUR is composing a response.' : chat.messages.length ? 'Response ready.' : ''}</div>
      {(chat.error || copyError) && <div className="notice error" role="alert"><span>{chat.error || copyError}</span>{chat.failedTurn && !chat.generating ? <button className="text-button" onClick={() => void chat.retry()}>Retry answer</button> : !chat.ready && !chat.loading ? <button className="text-button" onClick={chat.reload}>Reload conversation</button> : null}</div>}
      {voice.error && <p className="notice error" role="alert">{voice.error}</p>}
      {voice.active && <div className="voice-panel" role="region" aria-label="Voice conversation">
        <div className={`voice-indicator ${voice.state}`}><Volume2 size={22} /></div><div><strong role="status">{voice.state === 'listening' ? 'Listening to you…' : voice.state === 'speaking' ? 'NOUR is speaking' : 'Preparing your answer…'}</strong><p>AI-generated voice · microphone on only while listening</p></div>
        {voice.state === 'listening' && <button className="secondary-button" onClick={voice.finish}>Finish speaking</button>}
        <button className="secondary-button" onClick={voice.stop}>End voice</button>
      </div>}
      <form className="composer" onSubmit={event => { event.preventDefault(); send(); }}>
        <label htmlFor={`message-${session.id}`} className="sr-only">Message NOUR</label>
        <textarea id={`message-${session.id}`} ref={inputRef} rows={2} placeholder="Ask NOUR a question…" value={input} disabled={chat.loading || !chat.ready || voice.active} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
        <div className="composer-actions"><button type="button" className="icon-button" disabled={!voice.supported || chat.loading || !chat.ready || (chat.generating && !voice.active)} onClick={() => voice.active ? voice.stop() : void voice.start()} aria-label={voice.active ? 'End voice conversation' : 'Start voice conversation'} aria-pressed={voice.active} title={voice.supported ? 'AI voice conversation' : 'Voice is unavailable in this browser'}><Mic size={19} /></button>
          {chat.generating && !voice.active ? <button type="button" className="primary-button icon-only" onClick={chat.stop} aria-label="Stop generating"><Square size={18} /></button> : <button type="submit" className="primary-button icon-only" disabled={!input.trim() || chat.generating || chat.loading || !chat.ready || voice.active} aria-label="Send message"><Send size={19} /></button>}
        </div>
      </form><p className="composer-note">Answers include source references when available. Check them as you study.</p>
    </div>
  </section>;
}
