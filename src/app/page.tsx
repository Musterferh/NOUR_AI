'use client';

import { useCallback, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { ArrowRight, BookOpen, LockKeyhole, Menu } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import ExamSimulation from '@/components/ExamSimulation';
import ProgressDashboard from '@/components/ProgressDashboard';
import { apiJson, errorMessage, jsonRequest } from '@/lib/client-api';
import { CATEGORIES, MODES, type StudySession } from '@/types/frontend';
import { useMobile } from '@/hooks/useMobile';

type View = 'chat' | 'exam' | 'progress';
interface AuthStatus { authenticated: boolean; requiresPassword: boolean; coaching?: { configured: boolean; message?: string } }
function preference(key: string) {
  try { return typeof window === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}

export default function Home() {
  const mobile = useMobile();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authRetry, setAuthRetry] = useState(0);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [nextSessionCursor, setNextSessionCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(() => { const saved = preference('nour_category'); return saved && (CATEGORIES as readonly string[]).includes(saved) ? saved : CATEGORIES[0]; });
  const [mode, setMode] = useState<string>(MODES[0]);
  const [view, setView] = useState<View>(() => { const saved = preference('nour_view'); return saved === 'exam' || saved === 'progress' ? saved : 'chat'; });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => preference('nour_theme') === 'dark');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [examId, setExamId] = useState<string | undefined>();
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [examKey, setExamKey] = useState(0);
  const session = sessions.find(item => item.id === sessionId) ?? null;
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const onChatComplete = useCallback((id: string, text: string) => {
    setSessions(previous => previous.map(item => item.id === id && item.title === 'New Chat' ? { ...item, title: text.slice(0, 70) } : item));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('nour_theme', dark ? 'dark' : 'light'); localStorage.setItem('nour_category', category); localStorage.setItem('nour_view', view); } catch { /* Keep the current in-memory preference. */ }
  }, [dark, category, view]);

  useEffect(() => {
    const controller = new AbortController();
    apiJson<AuthStatus>('/api/auth', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setAuth(value); setAuthError(''); } }).catch(reason => { if (!controller.signal.aborted) setAuthError(errorMessage(reason)); });
    return () => controller.abort();
  }, [authRetry]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const controller = new AbortController();
    apiJson<StudySession[]>('/api/sessions', { signal: controller.signal }, response => { if (!controller.signal.aborted) setNextSessionCursor(response.headers.get('X-Next-Cursor')); }).then(values => {
      if (!Array.isArray(values)) throw new Error('Conversations could not be loaded. Please try again.');
      if (controller.signal.aborted) return;
      setSessions(values);
      let savedId: string | null = null;
      try { savedId = localStorage.getItem('nour_session'); } catch { /* Use the latest conversation. */ }
      const selected = values.find(item => item.id === savedId) ?? values[0];
      setSessionId(selected?.id ?? null);
      if (selected) { setCategory(selected.category); setMode(selected.mode || MODES[0]); }
      setError('');
    }).catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoadingSessions(false); });
    return () => controller.abort();
  }, [auth?.authenticated, sessionRetry]);

  const activate = (value: StudySession) => {
    setSessionId(value.id); setCategory(value.category); setMode(value.mode || MODES[0]); setView('chat');
    try { localStorage.setItem('nour_session', value.id); } catch { /* The server still retains the conversation. */ }
  };
  const loadMoreSessions = async () => {
    if (!nextSessionCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const values = await apiJson<StudySession[]>(`/api/sessions?cursor=${encodeURIComponent(nextSessionCursor)}`, undefined, response => setNextSessionCursor(response.headers.get('X-Next-Cursor')));
      if (!Array.isArray(values)) throw new Error('Older conversations could not be loaded.');
      setSessions(previous => [...previous, ...values.filter(value => !previous.some(item => item.id === value.id))]);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoadingMore(false); }
  };
  const login = async () => {
    setAuthBusy(true); setAuthError('');
    try {
      await apiJson('/api/auth', jsonRequest('POST', { password }));
      setPassword('');
      setAuth(await apiJson<AuthStatus>('/api/auth'));
    } catch (reason) { setAuthError(errorMessage(reason)); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError('');
    try {
      await apiJson('/api/auth', { method: 'DELETE' });
      setAuth(value => ({ authenticated: false, requiresPassword: value?.requiresPassword ?? true }));
      setSessions([]); setSessionId(null); setPassword(''); setLoadingSessions(true);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const createSession = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const value = await apiJson<StudySession>('/api/sessions', jsonRequest('POST', { category, mode }));
      if (!value.id) throw new Error('Your conversation could not be created.');
      setSessions(previous => [value, ...previous]); activate(value);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const updateSettings = async (nextCategory: string, nextMode: string) => {
    if (busy) return;
    if (!session || view !== 'chat') { setCategory(nextCategory); setMode(nextMode); return; }
    setBusy(true); setError('');
    try {
      const value = await apiJson<StudySession>('/api/sessions', jsonRequest('PATCH', { id: session.id, category: nextCategory, mode: nextMode }));
      setSessions(previous => previous.map(item => item.id === value.id ? value : item));
      setCategory(value.category); setMode(value.mode);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const deleteSession = async (id: string) => {
    const selected = sessions.find(item => item.id === id);
    if (busy || !window.confirm(`Delete “${selected?.title ?? 'this conversation'}” and its messages?`)) return;
    setBusy(true); setError('');
    // Unmount the active stream before removing its saved conversation.
    if (sessionId === id) setSessionId(null);
    try {
      await apiJson(`/api/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const remaining = sessions.filter(item => item.id !== id);
      setSessions(remaining);
      if (sessionId === id && remaining[0]) activate(remaining[0]);
    } catch (reason) { if (sessionId === id) setSessionId(id); setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const openView = (nextView: View) => {
    if (nextView === 'exam') { setExamId(undefined); setFocusTopics([]); setExamKey(value => value + 1); }
    setView(nextView);
  };

  if (!auth?.authenticated) return <main className="login-shell">
    <div className="login-frame">
      <aside className="login-identity" aria-label="About NOUR">
        <div className="login-brand"><Logo width={104} /><span className="login-edition">THE PRIVATE<br />STUDY ROOM</span></div>
        <div className="login-statement"><p className="eyebrow">A LITTLE EVERY DAY</p><p className="login-motto">Preparation,<br /><em>with purpose.</em></p><p className="login-introduction">A place to think clearly, deepen your knowledge, and prepare for what comes next.</p></div>
        <ol className="login-principles" aria-label="Your study routine"><li><span>01</span>Study</li><li><span>02</span>Practise</li><li><span>03</span>Reflect</li></ol>
      </aside>
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">WELCOME TO NOUR</p><h1 id="login-title">Your next chapter<br />starts here.</h1>
        <p className="login-description">Enter your private study space to continue with your coach, practice exams, and progress.</p>
        {authError && <p className="notice error" role="alert">{authError}</p>}
        {!auth ? authError ? <button className="primary-button" onClick={() => setAuthRetry(value => value + 1)}>Retry connection</button> : <p role="status">Opening your study space…</p> : <form onSubmit={event => { event.preventDefault(); void login(); }}>
          {auth.requiresPassword ? <><label htmlFor="access-password">Study space password</label><div className="password-field"><LockKeyhole size={18} /><input id="access-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} autoFocus /></div></> : <p className="muted small">Local development access is enabled.</p>}
          <button className="primary-button" disabled={authBusy || (auth.requiresPassword && !password)}>{authBusy ? 'Signing in…' : 'Enter my study space'}<ArrowRight size={17} /></button>
        </form>}
        <p className="login-footer"><LockKeyhole size={14} /><span>Your conversations and progress stay in your private study space.</span></p>
      </section>
    </div>
  </main>;

  return <main className="app-shell">
    <Sidebar open={sidebarOpen} mobile={mobile} close={closeSidebar} sessions={sessions} session={session} category={category} mode={mode} updateSettings={(nextCategory, nextMode) => void updateSettings(nextCategory, nextMode)} selectSession={id => { const selected = sessions.find(item => item.id === id); if (selected) activate(selected); }} createSession={() => void createSession()} deleteSession={id => void deleteSession(id)} view={view} setView={openView} dark={dark} toggleTheme={() => setDark(value => !value)} logout={() => void logout()} busy={busy || loadingSessions} hasMore={Boolean(nextSessionCursor)} loadingMore={loadingMore} loadMore={() => void loadMoreSessions()} />
    <div className="main-pane" inert={sidebarOpen && mobile ? true : undefined}>
      {error && <div className="notice error global-notice" role="alert"><span>{error}</span><button className="text-button" onClick={() => { setError(''); setLoadingSessions(true); setSessionRetry(value => value + 1); }}>Reload conversations</button></div>}
      {view === 'exam' ? <ExamSimulation key={`${examId || 'current'}-${examKey}`} category={category} focusTopics={focusTopics} attemptId={examId} setupError={auth.coaching?.configured === false ? auth.coaching.message || 'The coaching engine needs to be configured.' : undefined} onExit={() => setView('chat')} toggleSidebar={() => setSidebarOpen(true)} onProgress={() => setView('progress')} /> : view === 'progress' ? <ProgressDashboard toggleSidebar={() => setSidebarOpen(true)} review={id => { setExamId(id); setFocusTopics([]); setExamKey(value => value + 1); setView('exam'); }} revise={(nextCategory, topics) => { setCategory(nextCategory); setFocusTopics(topics); setExamId(undefined); setExamKey(value => value + 1); setView('exam'); }} /> : session ? <ChatInterface key={`${session.id}-${session.category}-${session.mode}`} session={session} onComplete={onChatComplete} toggleSidebar={() => setSidebarOpen(true)} /> : <section className="workspace"><header className="workspace-header"><div className="header-heading"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><h1>Study coach</h1></div></header><div className="chat-welcome"><div className="brand-orb"><BookOpen size={32} /></div><p className="eyebrow">WELCOME TO YOUR STUDY SPACE</p><h2>A little progress.<br /><span>Every day.</span></h2><p>{loadingSessions ? 'Loading your conversations…' : 'Choose a topic in the navigation, then start a conversation with NOUR.'}</p><button className="primary-button" disabled={busy || loadingSessions} onClick={() => void createSession()}>Start a conversation<ArrowRight size={17} /></button></div></section>}
    </div>
  </main>;
}
