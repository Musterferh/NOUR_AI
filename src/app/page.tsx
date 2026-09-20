"use client";

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import { Message } from '@/lib/kimi';

import ExamSimulation from '@/components/ExamSimulation';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("NCA 2003");
  const [activeMode, setActiveMode] = useState("Mode 1 (Teach)");
  const [isExamMode, setIsExamMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Load from local storage for theme/category
  useEffect(() => {
    const savedCategory = localStorage.getItem('nour_category');
    if (savedCategory) setActiveCategory(savedCategory);

    const savedTheme = localStorage.getItem('nour_theme');
    if (savedTheme === 'dark') setIsDarkMode(true);
  }, []);

  // Load sessions from DB
  const loadSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
      
      if (data.length > 0 && !activeSessionId) {
        setActiveSessionId(data[0].id);
        setActiveCategory(data[0].category);
      } else if (data.length === 0) {
        // Auto-create initial session
        createNewSession();
      }
    } catch (e) {
      console.error("Failed to load sessions");
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  // Fetch messages when active session changes
  useEffect(() => {
    if (activeSessionId) {
      fetch(`/api/messages?sessionId=${activeSessionId}`)
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(() => setMessages([]));
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('nour_category', activeCategory);
    localStorage.setItem('nour_theme', isDarkMode ? 'dark' : 'light');
  }, [activeCategory, isDarkMode]);

  const createNewSession = async () => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat', category: activeCategory })
      });
      const newSession = await res.json();
      setSessions([newSession, ...sessions]);
      setActiveSessionId(newSession.id);
      setIsExamMode(false);
    } catch (e) {
      console.error("Failed to create session");
    }
  };

  const deleteSession = async (id: string) => {
    await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' });
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (activeSessionId === id) {
      setActiveSessionId(newSessions.length > 0 ? newSessions[0].id : null);
    }
  };

  return (
    <div className={`flex h-screen font-sans overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-[#0a0a0a] text-gray-200' : 'bg-slate-50 text-slate-800'}`}>
      <Sidebar 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        activeMode={activeMode}
        setActiveMode={setActiveMode}
        sessions={sessions}
        activeSessionId={activeSessionId}
        setActiveSessionId={(id) => { setActiveSessionId(id); setIsExamMode(false); }}
        createNewSession={createNewSession}
        deleteSession={deleteSession}
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        isExamMode={isExamMode}
        setIsExamMode={setIsExamMode}
      />
      {isExamMode ? (
        <ExamSimulation 
          category={activeCategory} 
          isDarkMode={isDarkMode} 
          onExit={() => setIsExamMode(false)}
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      ) : (
        <ChatInterface 
          messages={messages} 
          setMessages={setMessages} 
          activeCategory={activeCategory} 
          activeMode={activeMode}
          activeSessionId={activeSessionId}
          createNewSession={createNewSession}
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
}
