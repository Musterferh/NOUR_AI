import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle2, XCircle, ChevronRight, ChevronLeft, Award, PlayCircle, Menu } from 'lucide-react';

interface Question {
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
}

interface ExamSimulationProps {
  category: string;
  isDarkMode: boolean;
  onExit: () => void;
  toggleSidebar?: () => void;
}

export default function ExamSimulation({ category, isDarkMode, onExit, toggleSidebar }: ExamSimulationProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [examFinished, setExamFinished] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  
  // Store user answers: index -> 'A' | 'B' | 'C' | 'D'
  const [answers, setAnswers] = useState<Record<number, string>>({});
  
  // 30 minutes in seconds
  const EXAM_DURATION = 30 * 60;
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION);

  const startExam = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/exam/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category })
      });
      
      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(`Server returned non-JSON response (Status ${res.status}): ${text.substring(0, 100)}...`);
      }

      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data)) throw new Error("API did not return a valid question array.");
      
      setQuestions(data);
      setExamStarted(true);
      setTimeLeft(EXAM_DURATION);
    } catch (e: any) {
      alert(`Failed to generate exam questions: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Timer effect
  useEffect(() => {
    if (examStarted && !examFinished && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (examStarted && timeLeft === 0 && !examFinished) {
      submitExam();
    }
  }, [examStarted, examFinished, timeLeft]);

  const submitExam = () => {
    setExamFinished(true);
  };

  const handleSelect = (option: string) => {
    setAnswers(prev => ({ ...prev, [currentIdx]: option }));
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const calculateScore = () => {
    let correct = 0;
    questions.forEach((q, idx) => {
      if (answers[idx] === q.correctAnswer) correct++;
    });
    return Math.round((correct / questions.length) * 100);
  };

  if (!examStarted) {
    return (
      <div className={`relative flex-1 flex flex-col items-center justify-center h-full transition-colors ${isDarkMode ? 'bg-[#0a0a0a] text-gray-100' : 'bg-slate-50 text-slate-800'}`}>
        {toggleSidebar && (
          <button
            className={`absolute top-4 left-4 md:hidden p-2 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
            onClick={toggleSidebar}
          >
            <Menu size={18} />
          </button>
        )}
        <div className={`max-w-md w-full p-8 rounded-3xl border shadow-xl text-center mx-4 ${isDarkMode ? 'bg-[#111] border-white/10 shadow-black/50' : 'bg-white border-slate-200 shadow-blue-900/5'}`}>
          <div className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center bg-gradient-to-br from-red-500 to-orange-500 shadow-lg shadow-red-500/20 text-white">
            <Clock size={32} />
          </div>
          <h2 className="text-2xl font-extrabold mb-2">Exam Simulator</h2>
          <p className={`text-sm mb-8 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
            You are about to start a strict 30-minute, 20-question Mock Examination focused on <strong>{category}</strong>. The chat interface will be disabled.
          </p>
          <button
            onClick={startExam}
            disabled={isLoading}
            className={`w-full py-3.5 rounded-xl text-white font-bold tracking-wide flex justify-center items-center gap-2 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:scale-100 ${isDarkMode ? 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30'}`}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <PlayCircle size={18} />
                START EXAM
              </>
            )}
          </button>
          <button onClick={onExit} className={`mt-4 text-sm font-medium ${isDarkMode ? 'text-gray-500 hover:text-white' : 'text-slate-400 hover:text-slate-800'}`}>
            Return to Chat
          </button>
        </div>
      </div>
    );
  }

  if (examFinished) {
    const score = calculateScore();
    const isPassing = score >= 90;

    return (
      <div className={`relative flex-1 overflow-y-auto p-4 md:p-8 h-full custom-scrollbar transition-colors ${isDarkMode ? 'bg-[#0a0a0a] text-gray-100' : 'bg-slate-50 text-slate-800'}`}>
        {toggleSidebar && (
          <button
            className={`absolute top-4 left-4 md:hidden p-2 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
            onClick={toggleSidebar}
          >
            <Menu size={18} />
          </button>
        )}
        <div className="max-w-4xl mx-auto pt-10 md:pt-0">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-extrabold tracking-tight">Exam Results</h2>
            <button onClick={onExit} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-white border hover:bg-slate-50 shadow-sm'}`}>
              Exit Simulator
            </button>
          </div>

          <div className={`mb-12 p-8 rounded-3xl flex flex-col items-center justify-center border shadow-xl ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-slate-200'}`}>
            <Award size={64} className={`mb-4 ${isPassing ? 'text-green-500' : 'text-orange-500'}`} />
            <div className={`text-6xl font-black tracking-tighter mb-2 ${isPassing ? 'text-green-500' : 'text-orange-500'}`}>
              {score}%
            </div>
            <p className={`text-lg font-bold ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>
              {isPassing ? 'Exceptional! You meet the 90%+ Standard.' : 'Keep training. Review the traps below.'}
            </p>
          </div>

          <h3 className="text-xl font-bold mb-6">Review & Explanations</h3>
          <div className="space-y-6">
            {questions.map((q, idx) => {
              const uAns = answers[idx];
              const isCorrect = uAns === q.correctAnswer;
              
              return (
                <div key={idx} className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#111] border-white/5' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="mt-1">
                      {isCorrect ? <CheckCircle2 className="text-green-500" size={20} /> : <XCircle className="text-red-500" size={20} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-lg leading-snug mb-4">{idx + 1}. {q.question}</p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                        {['A', 'B', 'C', 'D'].map(opt => {
                          const isOptCorrect = opt === q.correctAnswer;
                          const isOptSelected = opt === uAns;
                          
                          let optClass = isDarkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50';
                          if (isOptCorrect) optClass = 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400';
                          else if (isOptSelected && !isCorrect) optClass = 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400';

                          return (
                            <div key={opt} className={`p-3 rounded-xl border text-sm font-medium ${optClass}`}>
                              <span className="font-bold mr-2">{opt}:</span>
                              {(q.options as any)[opt]}
                            </div>
                          );
                        })}
                      </div>

                      <div className={`p-4 rounded-xl text-sm leading-relaxed ${isDarkMode ? 'bg-blue-900/20 text-blue-200' : 'bg-blue-50 text-blue-800'}`}>
                        <strong>Explanation:</strong> {q.explanation}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIdx];

  return (
    <div className={`relative flex-1 flex flex-col h-full transition-colors ${isDarkMode ? 'bg-[#0a0a0a] text-gray-100' : 'bg-slate-50 text-slate-800'}`}>
      {/* Exam Header */}
      <div className={`flex items-center justify-between px-4 md:px-8 py-4 border-b ${isDarkMode ? 'border-white/10 bg-[#111]' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-center gap-4">
          {toggleSidebar && (
            <button
              className={`md:hidden p-2 rounded-xl transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
              onClick={toggleSidebar}
            >
              <Menu size={18} />
            </button>
          )}
          <div className="font-bold tracking-tight">Question {currentIdx + 1} of {questions.length}</div>
        </div>
        <div className={`flex items-center gap-2 font-mono font-bold text-lg px-4 py-1.5 rounded-lg border ${timeLeft < 300 ? 'text-red-500 border-red-500/30 bg-red-500/10 animate-pulse' : (isDarkMode ? 'text-gray-300 border-white/10 bg-white/5' : 'text-slate-700 border-slate-200 bg-slate-100')}`}>
          <Clock size={16} />
          {formatTime(timeLeft)}
        </div>
        <button onClick={submitExam} className={`px-4 py-1.5 rounded-lg text-sm font-bold text-white transition-transform active:scale-95 ${isDarkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'}`}>
          Submit
        </button>
      </div>

      {/* Question Body */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
        <div className="max-w-3xl mx-auto mt-4 md:mt-12">
          <h2 className="text-2xl font-semibold leading-relaxed mb-8">
            {currentQ.question}
          </h2>

          <div className="space-y-3">
            {['A', 'B', 'C', 'D'].map(opt => {
              const isSelected = answers[currentIdx] === opt;
              return (
                <button
                  key={opt}
                  onClick={() => handleSelect(opt)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-4 group ${
                    isSelected 
                      ? (isDarkMode ? 'border-blue-500 bg-blue-500/10' : 'border-blue-500 bg-blue-50 shadow-md')
                      : (isDarkMode ? 'border-white/10 bg-[#111] hover:border-white/20' : 'border-slate-200 bg-white hover:border-slate-300')
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${isSelected ? 'border-blue-500 text-blue-500' : (isDarkMode ? 'border-white/20 text-gray-400 group-hover:border-white/40' : 'border-slate-300 text-slate-400 group-hover:border-slate-400')}`}>
                    {opt}
                  </div>
                  <div className={`flex-1 font-medium text-[15px] ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                    {(currentQ.options as any)[opt]}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Exam Footer Nav */}
      <footer className={`p-4 border-t flex items-center justify-between ${isDarkMode ? 'border-white/5 bg-[#111]' : 'border-slate-200 bg-white'}`}>
        <button 
          onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
          disabled={currentIdx === 0}
          className={`flex items-center gap-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-30 ${isDarkMode ? 'text-gray-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          <ChevronLeft size={16} /> Previous
        </button>

        <div className="flex gap-1">
          {questions.map((_, idx) => (
            <div key={idx} className={`w-2 h-2 rounded-full ${answers[idx] ? 'bg-blue-500' : (isDarkMode ? 'bg-white/20' : 'bg-slate-300')}`} />
          ))}
        </div>

        <button 
          onClick={() => setCurrentIdx(prev => Math.min(questions.length - 1, prev + 1))}
          disabled={currentIdx === questions.length - 1}
          className={`flex items-center gap-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-30 ${isDarkMode ? 'text-gray-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          Next <ChevronRight size={16} />
        </button>
      </footer>
    </div>
  );
}
