import { z } from 'zod';
import { CATEGORIES } from './config';

export const EXAM_QUESTION_COUNT = 5;
export const EXAM_DURATION_MS = 5 * 60 * 1000;
export const answerOptionSchema = z.enum(['A', 'B', 'C', 'D']);
export type AnswerOption = z.infer<typeof answerOptionSchema>;

export const examCategorySchema = z.enum(CATEGORIES);

export const generateExamSchema = z.object({
  category: examCategorySchema.default('General'),
  focusTopics: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
}).strict();

const optionText = z.string().trim().min(1).max(800);
const generatedQuestionSchema = z.object({
  question: z.string().trim().min(10).max(1800),
  topic: z.string().trim().min(1).max(120),
  options: z.object({ A: optionText, B: optionText, C: optionText, D: optionText }).strict()
    .refine(options => new Set(Object.values(options).map(option => option.toLocaleLowerCase())).size === 4,
      { message: 'Each question needs four distinct options.' }),
  correctAnswer: answerOptionSchema,
  explanation: z.string().trim().min(10).max(4000),
  sourceIds: z.array(z.string().min(1).max(200)).min(1).max(4),
}).strict();

export const generatedExamSchema = z.array(generatedQuestionSchema)
  .length(EXAM_QUESTION_COUNT)
  .refine(questions => new Set(questions.map(question => normalize(question.question))).size === questions.length,
    { message: 'Exam questions must be distinct.' });

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type ExamQuestion = GeneratedQuestion & { id: string };
export type ExamAnswers = Record<string, AnswerOption>;
export interface ExamSource {
  id: string;
  title: string;
  section?: string;
  page?: number;
  status: string;
  excerpt: string;
}

export interface StoredExamAttempt {
  id: string;
  ownerId: string;
  category: string;
  questions: string;
  sources: string;
  answers: string;
  revision: number;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  score: number | null;
}

export const answersSchema = z.record(z.string().uuid(), answerOptionSchema)
  .refine(answers => Object.keys(answers).length <= EXAM_QUESTION_COUNT,
    { message: 'Too many answers.' });
export const saveAnswersSchema = z.object({
  id: z.string().uuid(),
  answers: answersSchema,
  revision: z.number().int().nonnegative(),
}).strict();
export const submitExamSchema = z.object({
  id: z.string().uuid(),
  answers: answersSchema.default({}),
}).strict();

function normalize(text: string) {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function validateGeneratedExam(value: unknown, sourceIds: ReadonlySet<string>): GeneratedQuestion[] {
  const questions = generatedExamSchema.parse(value);
  for (const question of questions) {
    if (new Set(question.sourceIds).size !== question.sourceIds.length ||
        question.sourceIds.some(id => !sourceIds.has(id))) {
      throw new Error('Every question must cite distinct source IDs from the supplied knowledge bank.');
    }
  }
  return questions;
}

export function decodeQuestions(attempt: Pick<StoredExamAttempt, 'questions'>): ExamQuestion[] {
  const value: unknown = JSON.parse(attempt.questions);
  return z.array(generatedQuestionSchema.extend({ id: z.string().uuid() }))
    .length(EXAM_QUESTION_COUNT).parse(value);
}

export function decodeAnswers(attempt: Pick<StoredExamAttempt, 'answers'>): ExamAnswers {
  return answersSchema.parse(JSON.parse(attempt.answers));
}

export function mergeAnswers(questions: ExamQuestion[], existing: ExamAnswers, updates: ExamAnswers): ExamAnswers {
  const knownIds = new Set(questions.map(question => question.id));
  const validated = answersSchema.parse(updates);
  if (Object.keys(validated).some(id => !knownIds.has(id))) {
    throw new Error('An answer refers to a question outside this attempt.');
  }
  return { ...existing, ...validated };
}

export function gradeExam(questions: ExamQuestion[], answers: ExamAnswers): number {
  if (!questions.length) throw new Error('Cannot grade an empty exam.');
  const correct = questions.reduce((count, question) =>
    count + (answers[question.id] !== undefined && answers[question.id] === question.correctAnswer ? 1 : 0), 0);
  return Math.round((correct / questions.length) * 100);
}

export function isExpired(attempt: Pick<StoredExamAttempt, 'expiresAt'>, now = new Date()): boolean {
  return attempt.expiresAt.getTime() <= now.getTime();
}

export function publicAttempt(attempt: StoredExamAttempt) {
  const questions = decodeQuestions(attempt);
  return {
    id: attempt.id,
    category: attempt.category,
    questions: attempt.submittedAt ? questions : questions.map(question => ({
      id: question.id,
      topic: question.topic,
      question: question.question,
      options: question.options,
      sourceIds: question.sourceIds,
    })),
    sources: JSON.parse(attempt.sources) as ExamSource[],
    answers: decodeAnswers(attempt),
    revision: attempt.revision,
    startedAt: attempt.startedAt.toISOString(),
    expiresAt: attempt.expiresAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    ...(attempt.submittedAt ? { score: attempt.score } : {}),
  };
}

export function buildProgress(attempts: StoredExamAttempt[]) {
  const topics = new Map<string, { topic: string; total: number; correct: number; accuracy: number }>();
  const mistakes: Array<{
    question: string; answer: AnswerOption | null; correctAnswer: AnswerOption;
    explanation: string; category: string; topic: string; sourceIds: string[]; sources: ExamSource[];
  }> = [];

  const summaries = attempts.map(attempt => {
    const questions = decodeQuestions(attempt);
    const answers = decodeAnswers(attempt);
    if (attempt.submittedAt) {
      const sources = JSON.parse(attempt.sources) as ExamSource[];
      for (const question of questions) {
        const correct = answers[question.id] === question.correctAnswer;
        const key = normalize(question.topic);
        const topic = topics.get(key) ?? { topic: question.topic, total: 0, correct: 0, accuracy: 0 };
        topic.total++;
        if (correct) topic.correct++;
        topic.accuracy = Math.round(topic.correct / topic.total * 100);
        topics.set(key, topic);
        if (!correct && mistakes.length < 50) {
          mistakes.push({
            question: question.question,
            answer: answers[question.id] ?? null,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            category: attempt.category,
            topic: question.topic,
            sourceIds: question.sourceIds,
            sources: sources.filter(source => question.sourceIds.includes(source.id)),
          });
        }
      }
    }
    return {
      id: attempt.id, category: attempt.category,
      startedAt: attempt.startedAt.toISOString(), expiresAt: attempt.expiresAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null, score: attempt.score,
      answered: Object.keys(answers).length, total: questions.length, revision: attempt.revision,
    };
  });
  const weakTopics = [...topics.values()].sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
  return {
    attempts: summaries,
    weakTopics,
    mistakes,
    recommendedTopics: weakTopics.filter(topic => topic.accuracy < 90).slice(0, 5).map(topic => topic.topic),
    historyLimit: 100,
  };
}
