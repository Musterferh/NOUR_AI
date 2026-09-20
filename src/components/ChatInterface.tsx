import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Menu, Bot, User, Copy, Check, Sparkles, Mic, Volume2, VolumeX } from 'lucide-react';
import { Message } from '@/lib/kimi';

interface ChatProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  activeCategory: string;
  activeMode: string;
  activeSessionId: string | null;
  createNewSession: () => void;
  toggleSidebar: () => void;
  isDarkMode: boolean;
}

export default function ChatInterface({ messages, setMessages, activeCategory, activeMode, activeSessionId, createNewSession, toggleSidebar, isDarkMode }: ChatProps) {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isLiveVoiceMode, setIsLiveVoiceMode] = useState(false);
  const [liveVoiceState, setLiveVoiceState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevGenerating = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  // Standard Text-to-Speech (Free) or Live Voice TTS (Premium)
  useEffect(() => {
    if (prevGenerating.current && !isGenerating && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant') {

        // 1. Premium OpenAI TTS (Live Voice Mode)
        if (isLiveVoiceMode) {
          setLiveVoiceState('speaking');
          const speakOpenAI = async () => {
            try {
              const res = await fetch('/api/voice/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: lastMessage.content })
              });

              if (!res.ok) throw new Error('TTS failed');
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              activeAudioRef.current = audio;

              audio.onended = () => {
                // Auto-resume listening after speaking finishes!
                startLiveListening();
              };

              audio.play();
            } catch (err) {
              console.error(err);
              setLiveVoiceState('idle');
            }
          };
          speakOpenAI();
        }
      }
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, messages, isLiveVoiceMode]);

  const startLiveListening = async () => {
    try {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      let checkInterval: any;
      let audioContext: AudioContext | null = null;

      mediaRecorder.onstop = async () => {
        if (checkInterval) clearInterval(checkInterval);
        if (audioContext) audioContext.close();

        setLiveVoiceState('thinking');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'voice.webm');

        try {
          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) throw new Error('Transcription failed');
          const data = await res.json();

          if (data.text && data.text.trim()) {
            handleSubmit(data.text);
          } else {
            // Nothing heard, loop back
            startLiveListening();
          }
        } catch (err) {
          console.error(err);
          setLiveVoiceState('idle');
        }

        // Cleanup mic tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setLiveVoiceState('listening');

      // Silence Detection Logic
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.minDecibels = -70;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let silenceStart = Date.now();
        let hasSpoken = false;

        checkInterval = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const average = sum / dataArray.length;

          if (average > 10) {
            hasSpoken = true;
            silenceStart = Date.now(); // Reset silence timer when speaking
          } else if (hasSpoken && Date.now() - silenceStart > 1500) {
            // Silent for 1.5 seconds AFTER speaking
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          }
        }, 100);
      } catch (e) {
        console.error("AudioContext not supported for silence detection", e);
      }
    } catch (err) {
      console.error('Mic error:', err);
      setLiveVoiceState('idle');
    }
  };

  const stopLiveListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleLiveVoiceMode = () => {
    if (isLiveVoiceMode) {
      // Turn OFF
      setIsLiveVoiceMode(false);
      setLiveVoiceState('idle');
      stopLiveListening();
      if (activeAudioRef.current) activeAudioRef.current.pause();
    } else {
      // Turn ON
      setIsLiveVoiceMode(true);
      startLiveListening();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 144)}px`;
    }
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(index);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSubmit = async (text: string) => {
    if (!text.trim() || isGenerating) return;

    window.speechSynthesis.cancel();

    const userMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsGenerating(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages,
          activeCategory,
          activeMode,
          sessionId: activeSessionId
        })
      });

      if (!response.ok) throw new Error("API response not ok");
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices[0]?.delta?.content || "";
                setMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].content += content;
                  return newMsgs;
                });
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "An error occurred while communicating with the engine." }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(input);
    }
  };

  return (
    <div className={`flex-1 flex flex-col h-full relative overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-[#080810]' : 'bg-slate-50'}`}>

      {/* Ambient background gradients */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] opacity-20 ${isDarkMode ? 'bg-blue-600' : 'bg-blue-400'}`} />
        <div className={`absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] opacity-10 ${isDarkMode ? 'bg-indigo-500' : 'bg-indigo-400'}`} />
      </div>

      {/* ── HEADER ── */}
      <header className={`relative z-10 flex items-center justify-between px-5 py-3 border-b backdrop-blur-2xl transition-colors duration-300 ${isDarkMode ? 'bg-black/30 border-white/[0.06]' : 'bg-white/70 border-slate-200/80 shadow-sm'}`}>
        <div className="flex items-center gap-3">
          <button
            className={`md:hidden p-2 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
            onClick={toggleSidebar}
          >
            <Menu size={18} />
          </button>

          {/* NOUR branding pill */}
          <div className={`flex items-center gap-2.5 px-3 py-1.5 rounded-2xl border transition-colors ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600`}>
              <Bot size={14} className="text-white" />
            </div>
            <span className={`text-sm font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>NOUR</span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Online" />
          </div>

          <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-colors ${isDarkMode ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
            {activeCategory}
          </div>
        </div>

        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-colors ${isDarkMode ? 'bg-white/5 text-gray-500 border-white/5' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
          {activeMode}
        </div>
      </header>

      {/* ── MESSAGE FEED ── */}
      <div className="relative z-0 flex-1 overflow-y-auto custom-scrollbar scroll-smooth">

        {/* Live Voice Orb Overlay */}
        {isLiveVoiceMode && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-xl bg-black/60 md:bg-black/40">
            <div className="relative mb-6 md:mb-8 cursor-pointer group" onClick={() => liveVoiceState === 'listening' ? stopLiveListening() : null}>
              {/* Glow layers */}
              <div className={`absolute -inset-6 md:-inset-10 rounded-full blur-3xl transition-all duration-700 ${liveVoiceState === 'listening' ? 'bg-red-500/60 scale-110 animate-pulse' :
                  liveVoiceState === 'speaking' ? 'bg-blue-500/60 scale-125 animate-ping' :
                    liveVoiceState === 'thinking' ? 'bg-purple-500/60 scale-100 animate-spin' :
                      'bg-gray-500/20'
                }`} />

              {/* Orb */}
              <div className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center border-4 shadow-[0_0_80px_rgba(0,0,0,0.5)] transition-all duration-300 group-hover:scale-105 ${
                liveVoiceState === 'listening' ? 'border-red-400 bg-red-500/20 shadow-red-500/50' :
                liveVoiceState === 'speaking' ? 'border-blue-400 bg-blue-500/20 shadow-blue-500/50' :
                liveVoiceState === 'thinking' ? 'border-purple-400 bg-purple-500/20 shadow-purple-500/50' :
                'border-gray-500 bg-gray-500/20'
              }`}>
                {liveVoiceState === 'listening' && (
                  <div className="flex items-center justify-center gap-1.5 md:gap-2 h-12 md:h-16">
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <div 
                        key={bar} 
                        className="w-1.5 md:w-2 bg-red-400 rounded-full animate-[waveform_0.8s_ease-in-out_infinite]"
                        style={{
                          animationDelay: `${bar * 0.11}s`, // Slightly faster offset for listening
                          height: bar % 2 === 0 ? '80%' : '50%'
                        }}
                      />
                    ))}
                  </div>
                )}
                {liveVoiceState === 'speaking' && (
                  <div className="flex items-center justify-center gap-1.5 md:gap-2 h-12 md:h-16">
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <div 
                        key={bar} 
                        className="w-1.5 md:w-2 bg-blue-400 rounded-full animate-[waveform_0.8s_ease-in-out_infinite]"
                        style={{
                          animationDelay: `${bar * 0.15}s`,
                          height: bar % 2 === 0 ? '100%' : '60%'
                        }}
                      />
                    ))}
                  </div>
                )}
                {liveVoiceState === 'thinking' && <Sparkles size={40} className="text-purple-400 animate-spin md:w-12 md:h-12" />}
              </div>
            </div>

            <div className="text-center px-6">
              <h2 className="text-xl md:text-2xl font-black text-white tracking-widest uppercase">
                {liveVoiceState === 'listening' ? 'Listening...' :
                  liveVoiceState === 'speaking' ? 'NOUR is Speaking' :
                    liveVoiceState === 'thinking' ? 'Thinking...' : 'Idle'}
              </h2>
              {liveVoiceState === 'listening' && (
                <p className="text-sm font-medium text-blue-200/70 tracking-widest uppercase mt-2 animate-pulse">
                  Auto-detecting speech...
                </p>
              )}
            </div>

            <button
              onClick={toggleLiveVoiceMode}
              className="absolute bottom-10 md:bottom-12 px-8 py-3 rounded-full bg-white/10 text-white text-sm font-bold tracking-wider uppercase border border-white/10 hover:bg-white/20 hover:border-white/30 transition-all shadow-xl backdrop-blur-md"
            >
              End Session
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto px-6 py-12">
            <div className="relative mb-7 group">
              <div className={`absolute -inset-3 rounded-full blur-xl opacity-30 group-hover:opacity-50 transition-all duration-700 bg-gradient-to-r ${isDarkMode ? 'from-blue-500 to-indigo-600' : 'from-blue-400 to-indigo-500'}`} />
              <div className={`relative w-20 h-20 rounded-3xl flex items-center justify-center border transition-all duration-500 group-hover:scale-105 ${isDarkMode ? 'bg-[#0d0d1a] border-white/10 shadow-2xl' : 'bg-white border-blue-100 shadow-xl shadow-blue-100'}`}>
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-500/10 to-indigo-600/20" />
                <Bot size={34} strokeWidth={1.5} className={isDarkMode ? 'text-blue-400' : 'text-blue-600'} />
              </div>
            </div>

            <h1 className={`text-4xl font-black mb-4 tracking-tighter leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              Master Your{' '}
              <span className={`bg-clip-text text-transparent bg-gradient-to-r ${isDarkMode ? 'from-blue-400 via-indigo-400 to-purple-400' : 'from-blue-600 via-indigo-600 to-purple-600'}`}>
                Promotion.
              </span>
            </h1>

            <p className={`text-[15px] leading-relaxed max-w-md mx-auto ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
              I am NOUR, your AI-powered drill coach for the NCC Level 10 Exam. Select a topic or start typing to begin your training.
            </p>

            {/* Removed default suggestion buttons as requested */}
          </div>
        ) : (
          /* Messages */
          <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 group ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

                {/* Avatar */}
                <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5 shadow-md ${msg.role === 'user'
                  ? (isDarkMode ? 'bg-white/10 border border-white/10' : 'bg-white border border-slate-200')
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                  }`}>
                  {msg.role === 'user'
                    ? <User size={16} className={isDarkMode ? 'text-gray-300' : 'text-slate-500'} />
                    : <Bot size={16} className="text-white" />
                  }
                </div>

                {/* Bubble + label */}
                <div className={`flex flex-col gap-1 max-w-[82%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <span className={`text-[10px] font-bold tracking-widest uppercase px-1 ${isDarkMode ? 'text-gray-600' : 'text-slate-400'}`}>
                    {msg.role === 'user' ? 'You' : 'NOUR'}
                  </span>

                  {msg.role === 'user' ? (
                    <div className={`px-5 py-3 rounded-2xl rounded-tr-sm text-[14.5px] leading-relaxed whitespace-pre-wrap border transition-colors ${isDarkMode ? 'bg-white/8 border-white/8 text-gray-100 backdrop-blur-sm' : 'bg-white border-slate-200 text-slate-800 shadow-sm'}`}>
                      {msg.content}
                    </div>
                  ) : (
                    <div className={`text-[14.5px] leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>
                      <div className={`max-w-none prose-p:leading-relaxed prose-pre:rounded-xl prose-pre:border prose-headings:font-bold prose-headings:tracking-tight prose-li:leading-relaxed ${isDarkMode
                        ? 'prose prose-invert prose-blue prose-pre:bg-[#0d0d1a] prose-pre:border-white/10 prose-code:text-blue-400 prose-code:bg-white/5 prose-code:rounded'
                        : 'prose prose-slate prose-pre:bg-slate-900 prose-pre:border-slate-700 prose-a:text-blue-600'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <button
                      onClick={() => handleCopy(msg.content, idx)}
                      className={`mt-0.5 ml-1 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 ${isDarkMode ? 'text-gray-600 hover:text-gray-300 hover:bg-white/5' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                    >
                      {copiedId === idx ? <Check size={13} className={isDarkMode ? 'text-blue-400' : 'text-blue-600'} /> : <Copy size={13} />}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isGenerating && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md">
                  <Bot size={16} className="text-white" />
                </div>
                <div className="flex flex-col gap-1 items-start mt-0.5">
                  <span className={`text-[10px] font-bold tracking-widest uppercase px-1 ${isDarkMode ? 'text-gray-600' : 'text-slate-400'}`}>NOUR</span>
                  <div className={`flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm border ${isDarkMode ? 'bg-white/5 border-white/8' : 'bg-white border-slate-200 shadow-sm'}`}>
                    {[0, 150, 300].map(delay => (
                      <div key={delay} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── INPUT DOCK ── */}
      <div className={`relative z-10 px-4 pb-5 pt-3 transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-t from-[#080810] via-[#080810]/95 to-transparent' : 'bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent'}`}>
        <div className="max-w-3xl mx-auto flex items-end gap-2">

          {/* Live Voice Chat Button */}
          <button
            onClick={toggleLiveVoiceMode}
            title="Start Premium Live Voice Chat"
            className={`w-12 h-12 flex-shrink-0 rounded-2xl flex items-center justify-center transition-all duration-300 mb-0.5 shadow-lg group ${isLiveVoiceMode
              ? 'bg-gradient-to-br from-red-500 to-pink-600 shadow-red-500/40 text-white animate-pulse'
              : 'bg-gradient-to-br from-purple-500 to-indigo-600 shadow-purple-500/25 text-white hover:scale-105'}`}
          >
            <Sparkles size={20} className={isLiveVoiceMode ? '' : 'group-hover:animate-spin'} />
          </button>

          <div className={`flex-1 flex items-end gap-2 p-2 rounded-2xl border transition-all duration-300 shadow-xl ${isDarkMode
            ? 'bg-[#0e0e1a]/90 border-white/10 backdrop-blur-2xl focus-within:border-blue-500/40 focus-within:shadow-[0_0_40px_rgba(59,130,246,0.08)]'
            : 'bg-white border-slate-200/80 backdrop-blur-xl focus-within:border-blue-300 focus-within:shadow-[0_4px_30px_rgba(59,130,246,0.08)]'}`}>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              placeholder={'Ask NOUR anything...'}
              rows={1}
              className={`flex-1 bg-transparent resize-none outline-none min-h-[40px] max-h-40 py-2.5 px-3 text-[14.5px] leading-relaxed custom-scrollbar ${isDarkMode ? 'text-gray-100 placeholder-gray-600' : 'text-slate-800 placeholder-slate-400'}`}
            />

            {/* Send button */}
            <button
              onClick={() => handleSubmit(input)}
              disabled={!input.trim() || isGenerating}
              className={`w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center text-white transition-all duration-300 mb-0.5 shadow-lg disabled:shadow-none hover:scale-105 active:scale-95 ${isDarkMode
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 disabled:from-[#1a1a2e] disabled:to-[#1a1a2e] disabled:text-gray-600 shadow-blue-900/30'
                : 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 shadow-blue-500/25'}`}
            >
              <Send size={16} className={`ml-0.5 ${isGenerating ? 'opacity-50' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

