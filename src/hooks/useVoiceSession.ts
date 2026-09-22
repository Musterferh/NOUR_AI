'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '@/lib/client-api';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
const subscribeToCapabilities = () => () => undefined;
const hasVoiceSupport = () => typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.MediaRecorder === 'function';

export function useVoiceSession(send: (text: string) => Promise<string | null>, cancelSend: () => void) {
  const [active, setActive] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState('');
  const supported = useSyncExternalStore(subscribeToCapabilities, hasVoiceSupport, () => false);
  const token = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const context = useRef<AudioContext | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const callback = useRef(send);
  const cancel = useRef(cancelSend);

  useEffect(() => { callback.current = send; cancel.current = cancelSend; }, [send, cancelSend]);

  const releaseRecording = useCallback(() => {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    if (context.current) void context.current.close().catch(() => undefined);
    context.current = null;
    mic.current?.getTracks().forEach(track => track.stop());
    mic.current = null;
  }, []);

  const cleanup = useCallback(() => {
    request.current?.abort();
    request.current = null;
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
      recorder.current = null;
    }
    releaseRecording();
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current.src = ''; }
    audio.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, [releaseRecording]);

  const stop = useCallback(() => {
    token.current += 1;
    cleanup();
    cancel.current();
    setActive(false);
    setState('idle');
  }, [cleanup]);

  useEffect(() => () => { token.current += 1; cleanup(); }, [cleanup]);

  const start = useCallback(async () => {
    const run = ++token.current;
    cleanup();
    setError('');
    setActive(true);
    const current = () => token.current === run;
    const fail = (reason: unknown) => {
      if (!current()) return;
      cleanup();
      setActive(false);
      setState('idle');
      setError(errorMessage(reason));
    };

    const listen = async (): Promise<void> => {
      if (!current()) return;
      cleanup();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
        mic.current = stream;
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
        const recording = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.current = recording;
        const chunks: Blob[] = [];
        recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recording.onerror = () => fail(new Error('Recording failed. Check your microphone and try again.'));
        recording.onstop = () => {
          releaseRecording();
          recorder.current = null;
          if (!current()) return;
          void transcribe(new Blob(chunks, { type: recording.mimeType || mimeType || 'audio/webm' }));
        };
        recording.start();
        setState('listening');
        const started = Date.now();
        let lastSpeech = started;
        let spoke = false;
        let analyser: AnalyserNode | null = null;
        let frequencies: Uint8Array<ArrayBuffer> | null = null;
        try {
          const audioContext = new AudioContext();
          context.current = audioContext;
          void audioContext.resume().catch(() => undefined);
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          audioContext.createMediaStreamSource(stream).connect(analyser);
          frequencies = new Uint8Array(analyser.frequencyBinCount);
        } catch { /* Manual finish and maximum recording duration still work. */ }
        interval.current = setInterval(() => {
          if (!current() || recording.state !== 'recording') return;
          if (analyser && frequencies) {
            analyser.getByteFrequencyData(frequencies);
            const average = frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length;
            if (average > 12) { spoke = true; lastSpeech = Date.now(); }
          }
          if ((spoke && Date.now() - lastSpeech > 1500) || Date.now() - started > 60000) recording.stop();
        }, 100);
      } catch (reason) { fail(reason); }
    };

    const transcribe = async (blob: Blob) => {
      if (!current()) return;
      try {
        if (!blob.size) throw new Error('No audio was recorded. Please try again.');
        if (blob.size > 10 * 1024 * 1024) throw new Error('That recording is too long. Try a shorter question.');
        setState('thinking');
        const controller = new AbortController();
        request.current = controller;
        const form = new FormData();
        const extension = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        form.append('audio', blob, `voice.${extension}`);
        const response = await fetch('/api/voice/transcribe', { method: 'POST', body: form, signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Could not transcribe your recording. Please try again.');
        if (!current()) return;
        if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('No speech was detected. Start voice again or type your question.');
        const answer = await callback.current(result.text);
        if (!current()) return;
        if (!answer) throw new Error('The answer could not finish. Retry it in the conversation.');
        setState('speaking');
        const speech = await fetch('/api/voice/speak', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: answer.slice(0, 4000) }), signal: controller.signal,
        });
        if (!speech.ok) {
          const problem = await speech.json().catch(() => null);
          throw new Error(problem?.error || 'Could not play the answer. You can read it in the conversation.');
        }
        const sound = await speech.blob();
        if (!current()) return;
        const url = URL.createObjectURL(sound);
        objectUrl.current = url;
        const player = new Audio(url);
        audio.current = player;
        player.onended = () => { if (current()) void listen(); };
        player.onerror = () => fail(new Error('Audio playback failed. You can read the answer in the conversation.'));
        await player.play();
      } catch (reason) { fail(reason); }
    };
    await listen();
  }, [cleanup, releaseRecording]);

  return { active, state, error, supported, start, stop, finish: () => { if (recorder.current?.state === 'recording') recorder.current.stop(); } };
}
