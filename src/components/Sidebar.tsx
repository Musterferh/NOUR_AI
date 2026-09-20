import { MessageSquarePlus, X, BookOpen, Activity, LayoutGrid, Shield, Server, FileText, Moon, Sun, Clock } from 'lucide-react';
import Image from 'next/image';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  activeCategory: string;
  setActiveCategory: (val: string) => void;
  activeMode: string;
  setActiveMode: (val: string) => void;
  sessions: any[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string) => void;
  createNewSession: () => void;
  deleteSession: (id: string) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  isExamMode: boolean;
  setIsExamMode: (val: boolean) => void;
}

export default function Sidebar({ isOpen, setIsOpen, activeCategory, setActiveCategory, activeMode, setActiveMode, sessions, activeSessionId, setActiveSessionId, createNewSession, deleteSession, isDarkMode, toggleDarkMode, isExamMode, setIsExamMode }: SidebarProps) {
  const categories = [
    { name: "NCA 2003", icon: BookOpen },
    { name: "Spectrum", icon: Activity },
    { name: "QoS/QoE", icon: LayoutGrid },
    { name: "NIN-SIM & TIRMS", icon: Shield },
    { name: "Emerging Tech", icon: Server },
    { name: "Institutional Governance", icon: FileText }
  ];

  const modes = ["Mode 1 (Teach)", "Mode 2 (Drill/Quiz)"];

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className={`fixed inset-0 z-20 md:hidden transition-opacity ${isDarkMode ? 'bg-black/60 backdrop-blur-sm' : 'bg-slate-900/40 backdrop-blur-sm'}`} 
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <div className={`fixed md:static inset-y-0 left-0 z-30 w-72 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isDarkMode ? 'bg-[#0d0d0d] border-white/5 shadow-[4px_0_24px_rgba(0,0,0,0.5)]' : 'bg-white border-slate-200 shadow-[4px_0_24px_rgba(0,0,0,0.02)]'} border-r ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3 font-bold text-lg tracking-tight">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border overflow-hidden ${isDarkMode ? 'shadow-[0_0_20px_rgba(59,130,246,0.3)] border-white/10' : 'shadow-[0_4px_12px_rgba(59,130,246,0.3)] border-blue-400/20'}`}>
              <Image src="/logo.jpg" alt="NOUR AI Logo" width={36} height={36} className="object-cover" />
            </div>
            <span className={`bg-clip-text text-transparent bg-gradient-to-r ${isDarkMode ? 'from-gray-100 to-gray-400' : 'from-slate-800 to-slate-600'}`}>NOUR AI</span>
          </div>
          <button className={`md:hidden transition-colors ${isDarkMode ? 'text-gray-500 hover:text-gray-200' : 'text-slate-400 hover:text-slate-700'}`} onClick={() => setIsOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-8 custom-scrollbar">

          {/* Topic Switcher */}
          <div>
            <h3 className={`text-[10px] font-bold uppercase tracking-widest mb-3 px-1 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Topic Switcher</h3>
            <div className="space-y-1">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCategory === cat.name;
                const activeClasses = isDarkMode 
                  ? 'bg-gradient-to-r from-blue-500/15 to-transparent text-blue-400 border-l-2 border-blue-500' 
                  : 'bg-gradient-to-r from-blue-50 to-transparent text-blue-700 border-l-2 border-blue-500';
                const inactiveClasses = isDarkMode
                  ? 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200 border-l-2 border-transparent'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-l-2 border-transparent';
                
                return (
                  <button
                    key={cat.name}
                    onClick={() => { setActiveCategory(cat.name); setIsOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${isActive ? activeClasses : inactiveClasses}`}
                  >
                    <Icon size={16} className={isActive ? (isDarkMode ? 'text-blue-400' : 'text-blue-600') : (isDarkMode ? 'text-gray-500' : 'text-slate-400')} />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interaction Mode */}
          <div>
            <h3 className={`text-[10px] font-bold uppercase tracking-widest mb-3 px-1 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Interaction Mode</h3>
            <div className="space-y-2">
              {modes.map(mode => {
                const isActive = activeMode === mode && !isExamMode;
                const activeClasses = isDarkMode
                  ? 'bg-white/10 text-white border border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.03)]'
                  : 'bg-slate-800 text-white border border-slate-700 shadow-md';
                const inactiveClasses = isDarkMode
                  ? 'bg-transparent text-gray-500 hover:bg-white/5 hover:text-gray-300 border border-transparent hover:border-white/5'
                  : 'bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800 border border-transparent hover:border-slate-200';
                return (
                  <button
                    key={mode}
                    onClick={() => { setActiveMode(mode); setIsExamMode(false); setIsOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-300 ${isActive ? activeClasses : inactiveClasses}`}
                  >
                    {mode}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Exam Simulator */}
          <div>
            <button
              onClick={() => { setIsExamMode(true); setIsOpen(false); }}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-lg hover:-translate-y-0.5 active:translate-y-0 ${
                isExamMode 
                  ? 'bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-red-500/30'
                  : (isDarkMode ? 'bg-[#1a1a1a] border border-red-500/30 text-red-400 hover:bg-red-500/10' : 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100')
              }`}
            >
              <Clock size={14} className={isExamMode ? 'animate-pulse' : ''} />
              Exam Simulator
            </button>
          </div>

          {/* New Session + Session History */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Sessions</h3>
              <button
                onClick={() => { createNewSession(); setIsOpen(false); }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${isDarkMode ? 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white' : 'bg-slate-100 border border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700'}`}
              >
                <MessageSquarePlus size={13} />
                New
              </button>
            </div>
            <div className="space-y-1">
              {sessions.length === 0 ? (
                <p className={`text-xs px-3 py-2 ${isDarkMode ? 'text-gray-600' : 'text-slate-400'}`}>No sessions yet.</p>
              ) : (
                sessions.map((session) => {
                  const isActive = activeSessionId === session.id;
                  const activeClasses = isDarkMode 
                    ? 'bg-gradient-to-r from-blue-500/15 to-transparent text-blue-400 border-l-2 border-blue-500' 
                    : 'bg-gradient-to-r from-blue-50 to-transparent text-blue-700 border-l-2 border-blue-500';
                  const inactiveClasses = isDarkMode
                    ? 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200 border-l-2 border-transparent'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-l-2 border-transparent';
                  
                  return (
                    <div key={session.id} className="flex items-center gap-1 group/session">
                      <button
                        onClick={() => { setActiveSessionId(session.id); setIsOpen(false); }}
                        className={`flex-1 flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 truncate ${isActive ? activeClasses : inactiveClasses}`}
                      >
                        <span className="truncate w-full text-left">{session.title}</span>
                        <span className={`text-[10px] uppercase font-bold tracking-wider ${isDarkMode ? 'text-gray-600' : 'text-slate-400'}`}>{session.category}</span>
                      </button>
                      <button 
                        onClick={() => deleteSession(session.id)}
                        className={`p-1.5 rounded-md opacity-0 group-hover/session:opacity-100 transition-all ${isDarkMode ? 'text-red-400 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-50'}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        <div className={`p-4 border-t flex justify-between items-center transition-colors ${isDarkMode ? 'border-white/5 bg-[#0a0a0a]/50' : 'border-slate-100 bg-slate-50/50'}`}>
          <button 
            onClick={toggleDarkMode}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}`}
          >
            {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
            <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
          <Shield size={14} className={isDarkMode ? 'text-blue-500/80' : 'text-blue-500/80'} />
        </div>
      </div>
    </>
  );
}
