'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJson, errorMessage, jsonRequest } from '@/lib/client-api';
import { remainingSeconds } from '@/lib/chat-state';
import type { Answer, Answers, ExamAttempt } from '@/types/frontend';

function remember(attempt: ExamAttempt) {
  try {
    if (attempt.submittedAt) localStorage.removeItem(`nour_exam_draft:${attempt.id}`);
    else localStorage.setItem(`nour_exam_draft:${attempt.id}`, JSON.stringify(attempt.answers));
  } catch { /* Server autosave remains available when local storage is blocked. */ }
}

export function useExamAttempt(attemptId?: string) {
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const current = useRef<ExamAttempt | null>(null);
  const pending = useRef<Answers>({});
  const flight = useRef<Promise<void> | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const expiredSubmission = useRef<string | null>(null);

  const apply = useCallback((value: ExamAttempt) => {
    const previous = current.current;
    if (previous && (previous.id !== value.id || previous.revision > value.revision || (previous.submittedAt && !value.submittedAt))) return;
    current.current = value;
    remember(value);
    if (mounted.current) { setAttempt(value); setTimeLeft(remainingSeconds(value.expiresAt)); }
  }, []);

  const save = useCallback(async function save(): Promise<void> {
    while (true) {
    if (flight.current) { await flight.current; continue; }
    const value = current.current;
    if (!value || value.submittedAt || !Object.keys(pending.current).length) return;
    const snapshot = pending.current;
    pending.current = {};
    if (mounted.current) setSaving(true);
    const operation = async () => {
      try {
        let result: ExamAttempt;
        try {
          result = await apiJson<ExamAttempt>('/api/exam/attempt', { ...jsonRequest('PATCH', { id: value.id, answers: snapshot, revision: current.current?.revision }), keepalive: true });
        } catch (reason) {
          if (!(reason instanceof ApiError) || reason.status !== 409) throw reason;
          const fresh = await apiJson<ExamAttempt>(`/api/exam/attempt?id=${encodeURIComponent(value.id)}`);
          if (fresh.submittedAt) { pending.current = {}; apply(fresh); return; }
          current.current = { ...fresh, answers: { ...fresh.answers, ...snapshot, ...pending.current } };
          result = await apiJson<ExamAttempt>('/api/exam/attempt', jsonRequest('PATCH', { id: value.id, answers: snapshot, revision: fresh.revision }));
        }
        if (result.submittedAt) { pending.current = {}; apply(result); }
        else apply({ ...result, answers: { ...result.answers, ...pending.current } });
        if (mounted.current) setError('');
      } catch (reason) {
        pending.current = { ...snapshot, ...pending.current };
        if (mounted.current) setError(`Answers are saved on this device, but could not sync: ${errorMessage(reason)}`);
        throw reason;
      } finally {
        flight.current = null;
        if (mounted.current) setSaving(false);
      }
    };
    flight.current = operation();
    await flight.current;
    }
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    apiJson<ExamAttempt | null>(`/api/exam/attempt${attemptId ? `?id=${encodeURIComponent(attemptId)}` : ''}`, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted || !value) return;
        if (!Array.isArray(value.questions) || !value.questions.length) throw new Error('This exam could not be loaded.');
        if (!value.submittedAt && remainingSeconds(value.expiresAt) > 0) {
          try {
            const draft: unknown = JSON.parse(localStorage.getItem(`nour_exam_draft:${value.id}`) || '{}');
            if (draft && typeof draft === 'object') {
              for (const question of value.questions) {
                const answer = (draft as Record<string, unknown>)[question.id];
                if (typeof answer === 'string' && ['A', 'B', 'C', 'D'].includes(answer) && answer !== value.answers[question.id]) pending.current[question.id] = answer as Answer;
              }
            }
          } catch { /* Ignore a damaged local draft; server answers are authoritative. */ }
        }
        apply({ ...value, answers: { ...value.answers, ...pending.current } });
        if (Object.keys(pending.current).length) void save().catch(() => undefined);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [attemptId, apply, save]);

  const submit = useCallback(async () => {
    if (!current.current || current.current.submittedAt || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      // The submit endpoint accepts the final snapshot; a transient autosave
      // failure must not prevent an on-time submission.
      await save().catch(() => undefined);
      const value = current.current;
      if (!value || value.submittedAt) return;
      const result = await apiJson<ExamAttempt>('/api/exam/submit', jsonRequest('POST', { id: value.id, answers: value.answers }));
      pending.current = {};
      apply(result);
    } catch (reason) { if (mounted.current) setError(errorMessage(reason)); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }, [apply, save]);

  const activeAttemptId = attempt?.id;
  const expiresAt = attempt?.expiresAt;
  const submittedAt = attempt?.submittedAt;
  useEffect(() => {
    if (!activeAttemptId || !expiresAt || submittedAt) return;
    const tick = () => {
      const seconds = remainingSeconds(expiresAt);
      setTimeLeft(seconds);
      if (!seconds && expiredSubmission.current !== activeAttemptId) {
        expiredSubmission.current = activeAttemptId;
        void submit();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [activeAttemptId, expiresAt, submittedAt, submit]);

  const generate = async (category: string, focusTopics?: string[]) => {
    setBusy(true); setError('');
    try {
      const value = await apiJson<ExamAttempt>('/api/exam/generate', jsonRequest('POST', { category, focusTopics }));
      if (!Array.isArray(value.questions) || !value.questions.length) throw new Error('No valid questions were returned. Please try again.');
      pending.current = {}; expiredSubmission.current = null;
      apply(value);
    } catch (reason) { if (mounted.current) setError(errorMessage(reason)); }
    finally { if (mounted.current) setBusy(false); }
  };

  const choose = (questionId: string, answer: Answer) => {
    const value = current.current;
    if (!value || value.submittedAt || remainingSeconds(value.expiresAt) === 0) return;
    pending.current = { ...pending.current, [questionId]: answer };
    apply({ ...value, answers: { ...value.answers, [questionId]: answer } });
    void save().catch(() => undefined);
  };

  return { attempt, loading, busy, saving, error, timeLeft, generate, choose, submit, retrySave: () => void save().catch(() => undefined), reset: () => { current.current = null; pending.current = {}; setAttempt(null); setError(''); } };
}
