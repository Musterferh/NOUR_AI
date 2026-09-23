export const CATEGORIES = ['NCA 2003', 'Spectrum', 'QoS/QoE', 'NIN-SIM & TIRMS', 'Emerging Tech', 'Institutional Governance'] as const;
export const MODES = ['MODE 1 — TEACH', 'MODE 2 — DRILL', 'MODE 3 — SIMULATE'] as const;

export interface StudySession {
  id: string;
  title: string;
  category: string;
  mode: string;
}

export interface SourceReference {
  id: string;
  title: string;
  section?: string;
  page?: number;
  status: string;
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  sources?: SourceReference[];
  turnId?: string;
}

export type Answer = 'A' | 'B' | 'C' | 'D';
export type Answers = Record<string, Answer>;
export interface ExamQuestion {
  id: string;
  question: string;
  topic?: string;
  options: Record<Answer, string>;
  sourceIds: string[];
  correctAnswer?: Answer;
  explanation?: string;
}
export interface ExamAttempt {
  id: string;
  category: string;
  questions: ExamQuestion[];
  answers: Answers;
  sources: SourceReference[];
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  score?: number;
  revision: number;
}
export interface ProgressData {
  attempts: Array<Pick<ExamAttempt, 'id' | 'category' | 'startedAt' | 'expiresAt' | 'submittedAt' | 'score'> & { answered: number; total: number }>;
  weakTopics: Array<{ topic: string; total: number; correct: number; accuracy: number }>;
  mistakes: Array<{ question: string; answer: Answer | null; correctAnswer: Answer; explanation: string; category: string; topic: string; sourceIds: string[]; sources?: SourceReference[] }>;
  recommendedTopics: string[];
}
