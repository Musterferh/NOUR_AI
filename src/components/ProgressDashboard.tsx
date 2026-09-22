'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Menu, Target } from 'lucide-react';
import { apiJson, errorMessage } from '@/lib/client-api';
import type { ProgressData } from '@/types/frontend';
import Sources from './Sources';

interface Props { toggleSidebar: () => void; review: (id: string) => void; revise: (category: string, topics: string[]) => void }

export default function ProgressDashboard({ toggleSidebar, review, revise }: Props) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiJson<ProgressData>('/api/progress', { signal: controller.signal })
      .then(value => { if (!Array.isArray(value.attempts) || !Array.isArray(value.mistakes) || !Array.isArray(value.weakTopics)) throw new Error('Progress could not be loaded.'); setData(value); setError(''); })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [retry]);
  const completed = data?.attempts.filter(attempt => attempt.submittedAt) ?? [];
  const average = completed.length ? Math.round(completed.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / completed.length) : 0;

  return <section className="workspace" aria-label="Study progress"><header className="workspace-header"><div className="header-heading"><button className="icon-button mobile-menu" onClick={toggleSidebar} aria-label="Open navigation"><Menu size={20} /></button><div><p className="eyebrow">SMALL STEPS. LASTING KNOWLEDGE.</p><h1>My progress</h1></div></div><BarChart3 className="header-symbol" size={25} /></header><div className="workspace-scroll"><div className="content-column">
    {error && <div className="notice error" role="alert"><span>{error}</span><button className="text-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!data && !error ? <p className="empty-note" role="status">Loading your study progress…</p> : data && <>
      <div className="stats-grid"><div className="card stat"><span>Completed exams</span><strong>{completed.length}</strong></div><div className="card stat"><span>Average score</span><strong>{completed.length ? `${average}%` : '—'}</strong></div><div className="card stat"><span>Study target</span><strong>90<span>%</span></strong></div></div>
      {!completed.length && <div className="card welcome-progress"><Target size={30} /><h2>Build a picture of your progress.</h2><p>Complete an exam to see your strongest topics, review mistakes, and focus your next practice session.</p><button className="primary-button" onClick={() => revise('NCA 2003', [])}>Start a practice exam<ArrowRight size={16} /></button></div>}
      {data.weakTopics.length > 0 && <section className="card"><div className="section-heading"><div><p className="eyebrow">WHERE TO FOCUS NEXT</p><h2>Topic accuracy</h2></div></div><div className="topic-list">{data.weakTopics.map(topic => { const category = data.mistakes.find(mistake => mistake.topic === topic.topic)?.category; return <div className="topic-row" key={topic.topic}><div><strong>{topic.topic}</strong><p className="muted small">{topic.correct} of {topic.total} correct</p></div><div className="accuracy"><progress value={topic.accuracy} max={100} aria-label={`${topic.topic} accuracy`} /><span>{Math.round(topic.accuracy)}%</span></div><button className="text-button" onClick={() => revise(category || 'NCA 2003', [topic.topic])}>Practise<ArrowRight size={14} /></button></div>; })}</div></section>}
      <section><h2 className="section-title">Exam history</h2>{data.attempts.length ? <div className="card history-list">{data.attempts.map(attempt => <button key={attempt.id} onClick={() => review(attempt.id)}><div><strong>{attempt.category}</strong><p>{new Date(attempt.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {attempt.answered}/{attempt.total} answered</p></div><span className="history-score">{attempt.submittedAt ? `${attempt.score ?? 0}%` : 'Resume'}<ArrowRight size={16} /></span></button>)}</div> : <p className="muted">Your completed and saved exams will appear here.</p>}</section>
      {data.mistakes.length > 0 && <section><div className="section-heading"><div><p className="eyebrow">TURN MISTAKES INTO PROGRESS</p><h2>Mistake notebook</h2></div><span className="mode-badge">{data.mistakes.length} to review</span></div><div className="review-list">{data.mistakes.map((mistake, index) => <article key={`${mistake.question}-${index}`} className="card review-card"><p className="eyebrow">{mistake.category} · {mistake.topic}</p><h3>{mistake.question}</h3><div className="mistake-answer"><span>Your answer: <strong>{mistake.answer || 'Not answered'}</strong></span><span>Correct answer: <strong>{mistake.correctAnswer}</strong></span></div><p className="explanation">{mistake.explanation}</p><Sources sources={mistake.sources} /><button className="text-button" onClick={() => revise(mistake.category, [mistake.topic])}>Practise this topic<ArrowRight size={14} /></button></article>)}</div></section>}
    </>}
  </div></div></section>;
}
