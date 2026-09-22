'use client';

import { useEffect, useRef } from 'react';
import Logo from './Logo';
import { BarChart3, BookOpen, Clock, LogOut, MessageSquarePlus, Moon, Sun, Trash2, X } from 'lucide-react';
import type { StudySession } from '@/types/frontend';
import { CATEGORIES, MODES } from '@/types/frontend';

interface Props {
  open: boolean; mobile: boolean; close: () => void; sessions: StudySession[]; session: StudySession | null;
  category: string; mode: string; updateSettings: (category: string, mode: string) => void;
  selectSession: (id: string) => void; createSession: () => void; deleteSession: (id: string) => void;
  view: 'chat' | 'exam' | 'progress'; setView: (view: 'chat' | 'exam' | 'progress') => void;
  dark: boolean; toggleTheme: () => void; logout: () => void; busy: boolean;
  hasMore: boolean; loadingMore: boolean; loadMore: () => void;
}

export default function Sidebar(props: Props) {
  const container = useRef<HTMLElement>(null);
  const close = props.close;
  useEffect(() => {
    if (!props.open || !props.mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]') ?? []);
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [props.open, props.mobile, close]);

  return <>
    {props.open && <button className="nav-backdrop" onClick={close} aria-label="Close navigation" tabIndex={-1} />}
    <aside ref={container} className={`sidebar ${props.open ? 'is-open' : ''}`} aria-label="Study navigation">
      <div className="sidebar-brand"><div className="sidebar-brand-lockup"><Logo width={80} /><p>YOUR NEXT LEVEL</p></div><button className="icon-button mobile-menu" onClick={close} aria-label="Close navigation"><X size={19} /></button></div>
      <div className="sidebar-scroll">
        <button className="primary-button new-session" onClick={() => { props.createSession(); close(); }} disabled={props.busy}><MessageSquarePlus size={17} /> New conversation</button>
        <nav className="view-nav" aria-label="Study tools">
          {([{ id: 'chat', label: 'Study coach', icon: BookOpen }, { id: 'exam', label: 'Exam simulator', icon: Clock }, { id: 'progress', label: 'My progress', icon: BarChart3 }] as const).map(item => <button key={item.id} disabled={props.busy} className={props.view === item.id ? 'selected' : ''} aria-current={props.view === item.id ? 'page' : undefined} onClick={() => { props.setView(item.id); close(); }}><item.icon size={17} />{item.label}</button>)}
        </nav>
        <div className="sidebar-section"><label className="eyebrow" htmlFor="study-topic">STUDY TOPIC</label><select id="study-topic" value={props.category} disabled={props.busy} onChange={event => props.updateSettings(event.target.value, props.mode)}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select>
          <label className="eyebrow" htmlFor="study-mode">COACHING STYLE</label><select id="study-mode" value={props.mode} disabled={props.busy} onChange={event => props.updateSettings(props.category, event.target.value)}>{MODES.map(mode => <option key={mode}>{mode}</option>)}</select>
        </div>
        <div className="sidebar-section"><h2 className="eyebrow">CONVERSATIONS</h2>{!props.sessions.length && <p className="muted small">Start a conversation to begin.</p>}<ul className="session-list">{props.sessions.map(session => <li key={session.id} className={props.session?.id === session.id && props.view === 'chat' ? 'active' : ''}><button className="session-select" disabled={props.busy} onClick={() => { props.selectSession(session.id); close(); }} aria-current={props.session?.id === session.id && props.view === 'chat' ? 'true' : undefined}><span>{session.title}</span><small>{session.category}</small></button><button className="icon-button delete-session" disabled={props.busy} onClick={() => props.deleteSession(session.id)} aria-label={`Delete conversation ${session.title}`}><Trash2 size={14} /></button></li>)}</ul>{props.hasMore && <button className="text-button" onClick={props.loadMore} disabled={props.loadingMore}>{props.loadingMore ? 'Loading…' : 'Load older conversations'}</button>}</div>
      </div>
      <div className="sidebar-footer"><button className="text-button" onClick={props.toggleTheme}>{props.dark ? <Sun size={16} /> : <Moon size={16} />}{props.dark ? 'Light mode' : 'Dark mode'}</button><button className="icon-button" onClick={props.logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div>
    </aside>
  </>;
}
