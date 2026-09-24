'use client';

import { useState } from 'react';
import { Award, ArrowLeft, ArrowRight, Clock, Menu, Play, RotateCcw } from 'lucide-react';
import { useExamAttempt } from '@/hooks/useExamAttempt';
import type { Answer } from '@/types/frontend';
import Sources from './Sources';

interface Props { category: string; focusTopics?: string[]; attemptId?: string; setupError?: string; onExit: () => void; toggleSidebar: () => void; onProgress: () => void }

export default function ExamSimulation({ category, focusTopics, attemptId, setupError, onExit, toggleSidebar, onProgress }: Props) {
  const exam = useExamAttempt(attemptId);
  const [index, setIndex] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const attempt = exam.attempt;
  const answered = attempt ? Object.keys(attempt.answers).length : 0;
  const question = attempt?.questions[index];
  const options: Answer[] = ['A', 'B', 'C', 'D'];
  const minutes = Math.floor(exam.timeLeft / 60);
  const seconds = (exam.timeLeft % 60).toString().padStart(2, '0');

  return <section className="workspace" aria-label="Exam simulator">
    <header className="workspace-header"><div className="header-heading"><button className="icon-button mobile-menu" onClick={toggleSidebar} aria-label="Open navigation"><Menu size={20} /></button><div><p className="eyebrow">PUT YOUR KNOWLEDGE TO WORK</p><h1>{attempt?.submittedAt ? 'Exam review' : 'Exam simulator'}</h1></div></div><button className="text-button" onClick={onExit}>Back to coach</button></header>
    <div className="workspace-scroll"><div className="content-column">
      {exam.error && attempt && <div className="notice error" role="alert"><span>{exam.error}</span>{!attempt.submittedAt && <button className="text-button" onClick={exam.retrySave}>Retry save</button>}</div>}
      {exam.loading ? <p className="empty-note" role="status">Checking for a saved exam…</p> : !attempt ? <div className="exam-intro card">
        <div className="brand-orb"><Clock size={32} /></div><p className="eyebrow">MAKE PRACTICE COUNT</p><h2>Ready for your next challenge?</h2><p>A 5-question exam on <strong>{category}</strong>. You have 5 minutes. Your answers save as you go, and the timer continues if you leave or close the page.</p>
        {Boolean(focusTopics?.length) && <p className="focus-topics">Revision focus: {focusTopics?.join(', ')}</p>}
        <div className="exam-facts"><span><strong>5</strong> questions</span><span><strong>5</strong> minutes</span><span><strong>90%</strong> study target</span></div>
        {setupError ? <div className="notice error" role="alert"><div><strong>Exam setup needed</strong><p>{setupError}</p><p>For this local study app, update <code>.env.local</code>, restart the app, then refresh.</p><button className="text-button" onClick={() => window.location.reload()}>Refresh setup</button></div></div> : exam.error && <div className="notice error" role="alert">{exam.error}</div>}
        <button className="primary-button" disabled={exam.busy || exam.loading || Boolean(setupError)} onClick={() => { setIndex(0); void exam.generate(category, focusTopics); }}><Play size={17} />{exam.busy ? 'Preparing your exam…' : 'Start exam'}</button><p className="muted small">Questions are based on your study materials. Results and explanations appear after submission.</p>
      </div> : attempt.submittedAt ? <>
        <div className="result-banner card"><Award size={42} /><div><p className="eyebrow">{attempt.category}</p><h2>{attempt.score ?? 0}%</h2><p>{(attempt.score ?? 0) >= 90 ? 'You reached your 90% study target.' : 'Every review is another step forward.'}</p></div><div className="button-stack"><button className="primary-button" onClick={onProgress}>View my progress</button><button className="secondary-button" onClick={() => { setIndex(0); exam.reset(); }}><RotateCcw size={16} />New practice exam</button></div></div>
        <h2 className="section-title">Review your answers</h2><div className="review-list">{attempt.questions.map((item, position) => { const selected = attempt.answers[item.id]; const correct = selected === item.correctAnswer; return <article className="card review-card" key={item.id}><div className="review-heading"><span className={`result-label ${correct ? 'correct' : 'incorrect'}`}>{correct ? 'Correct' : selected ? 'Review needed' : 'Unanswered'}</span><span className="muted small">Question {position + 1}</span></div><h3>{item.question}</h3><ul className="review-options">{options.map(option => <li key={option} className={option === item.correctAnswer ? 'correct-option' : option === selected ? 'wrong-option' : ''}><strong>{option}.</strong> {item.options[option]}{option === item.correctAnswer && <span>Correct answer</span>}{option === selected && <span>Your answer</span>}</li>)}</ul><p className="explanation"><strong>Why:</strong> {item.explanation}</p><Sources sources={attempt.sources?.filter(source => item.sourceIds?.includes(source.id))} /></article>; })}</div>
      </> : question ? <>
        <div className="exam-status"><div><p className="eyebrow">{attempt.category}</p><strong>Question {index + 1} of {attempt.questions.length}</strong><p className="muted small" role="status">{exam.saving ? 'Saving your answer…' : exam.error ? 'Changes need to sync' : 'Answers saved'} · {answered} answered</p></div><div className={`exam-clock ${exam.timeLeft < 60 ? 'running-low' : ''}`} role="timer" aria-label={`${minutes} minutes ${seconds} seconds remaining`}><Clock size={19} />{minutes}:{seconds}</div></div>
        {!exam.timeLeft && <p className="notice" role="status">Time is up. Your saved answers will be graded.{!exam.busy && <button className="text-button" onClick={() => void exam.submit()}>Finish submission</button>}</p>}
        <fieldset className="card question-card" disabled={exam.busy || !exam.timeLeft}><legend><span className="eyebrow">{question.topic || 'CHOOSE ONE ANSWER'}</span><span className="question-text">{question.question}</span></legend><div className="answer-options">{options.map(option => <label key={option} className={`answer-option ${attempt.answers[question.id] === option ? 'selected' : ''}`}><input type="radio" name={`question-${question.id}`} value={option} checked={attempt.answers[question.id] === option} onChange={() => exam.choose(question.id, option)} /><span className="answer-letter">{option}</span><span>{question.options[option]}</span></label>)}</div></fieldset>
        <nav className="question-nav" aria-label="Jump to question">{attempt.questions.map((item, position) => <button key={item.id} onClick={() => setIndex(position)} className={`${position === index ? 'current' : ''} ${attempt.answers[item.id] ? 'answered' : ''}`} aria-label={`Question ${position + 1}${attempt.answers[item.id] ? ', answered' : ', unanswered'}`} aria-current={position === index ? 'step' : undefined}>{position + 1}</button>)}</nav>
        <div className="exam-controls"><button className="secondary-button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft size={16} />Previous</button><button className="primary-button" disabled={exam.busy} onClick={() => setConfirmSubmit(true)}>{exam.busy ? 'Submitting…' : 'Submit exam'}</button><button className="secondary-button" disabled={index === attempt.questions.length - 1} onClick={() => setIndex(value => value + 1)}>Next<ArrowRight size={16} /></button></div>
        {confirmSubmit && <div className="card submit-confirm" role="region" aria-label="Confirm exam submission"><h3>Finish this attempt?</h3><p>{attempt.questions.length - answered ? `${attempt.questions.length - answered} questions are unanswered.` : 'You have answered every question.'} You can review explanations after submitting.</p><div className="button-row"><button className="primary-button" disabled={exam.busy} onClick={() => { setConfirmSubmit(false); void exam.submit(); }}>Confirm submission</button><button className="secondary-button" onClick={() => setConfirmSubmit(false)}>Keep working</button></div></div>}
      </> : <p className="notice error">This question could not be loaded.</p>}
    </div></div>
  </section>;
}
