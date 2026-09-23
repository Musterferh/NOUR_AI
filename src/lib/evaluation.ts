import { boundHistory, buildCoachMessages } from './coaching';
import { modelDeltas } from './model-stream';
import { KIMI_REASONING_LIMITS, type Message } from './kimi';
import { extractCitationIds } from './citations';
import type { Chunk, RetrievalRequest, RetrievalResult, SourceReference } from '../types';

export const EVALUATION_LIMITS = {
  requests: 12, tokensPerRequest: 16_384, totalCompletionTokens: 196_608,
  inputCharactersPerRequest: 150_000, totalInputCharacters: 1_000_000,
  timeoutMs: 240_000, totalTimeoutMs: 1_800_000, answerCharacters: 24_000,
} as const;

export interface EvaluationOptions {
  live: boolean;
  maxRequests: number;
  maxTokens: number;
  maxTotalTokens: number;
  maxInputCharacters: number;
  maxTotalInputCharacters: number;
  timeoutMs: number;
  maxDurationMs: number;
  outputDirectory: string;
  caseIds: string[];
  help: boolean;
}

export function parseEvaluationArguments(args: string[]): EvaluationOptions {
  const options: EvaluationOptions = {
    live: false, maxRequests: 10, maxTokens: 16_384, maxTotalTokens: 131_072,
    maxInputCharacters: 100_000, maxTotalInputCharacters: 800_000,
    timeoutMs: 240_000, maxDurationMs: 1_800_000,
    outputDirectory: '.npm-cache/evaluations', caseIds: [], help: false,
  };
  const numeric: Record<string, { key: keyof EvaluationOptions; cap: number }> = {
    '--max-requests': { key: 'maxRequests', cap: EVALUATION_LIMITS.requests },
    '--max-tokens': { key: 'maxTokens', cap: EVALUATION_LIMITS.tokensPerRequest },
    '--max-total-tokens': { key: 'maxTotalTokens', cap: EVALUATION_LIMITS.totalCompletionTokens },
    '--max-input-characters': { key: 'maxInputCharacters', cap: EVALUATION_LIMITS.inputCharactersPerRequest },
    '--max-total-input-characters': { key: 'maxTotalInputCharacters', cap: EVALUATION_LIMITS.totalInputCharacters },
    '--timeout-ms': { key: 'timeoutMs', cap: EVALUATION_LIMITS.timeoutMs },
    '--max-duration-ms': { key: 'maxDurationMs', cap: EVALUATION_LIMITS.totalTimeoutMs },
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag) && flag !== '--case') throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--live') { options.live = true; continue; }
    if (flag === '--dry-run') { options.live = false; continue; }
    if (flag === '--help') { options.help = true; continue; }
    if (!(flag in numeric) && flag !== '--output' && flag !== '--case') throw new Error(`Unknown argument: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--output') { options.outputDirectory = value; continue; }
    if (flag === '--case') { options.caseIds.push(value); continue; }
    const { key, cap } = numeric[flag];
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > cap) throw new Error(`${flag} must be an integer from 1 to ${cap}.`);
    Object.assign(options, { [key]: parsed });
  }
  if (seen.has('--live') && seen.has('--dry-run')) throw new Error('Choose --live or --dry-run, not both.');
  return options;
}

export interface AnswerCheck {
  id: string;
  description: string;
  any: string[];
  absent?: boolean;
}
export interface ReferenceFixture {
  id: string;
  hashKind: 'source-file' | 'checked-excerpt';
  sha256: string;
  passagePattern: string;
  expectedFact: string;
}
export interface EvaluationTurn {
  id: string;
  category?: string;
  mode?: string;
  prompt: string;
  checks: AnswerCheck[];
  requireCitation?: boolean;
  expectedSourceIds?: string[];
  manualReview: string[];
  /** Used only to build an explicitly simulated retrieval plan, never scored. */
  planningReply: string;
}
export interface ConversationCase {
  id: string;
  description: string;
  category: string;
  mode: string;
  references: ReferenceFixture[];
  turns: EvaluationTurn[];
}
export interface CheckResult { id: string; description: string; passed: boolean; detail?: string }
export interface TurnResult {
  id: string;
  status: 'planned' | 'complete' | 'failed' | 'skipped';
  prompt: string;
  category: string;
  mode: string;
  historyMessages: number;
  retainedSourceIds: string[];
  retrievalQuality?: RetrievalResult['quality'];
  sources: SourceReference[];
  reasoning?: { effort: 'low' | 'high'; reasons: string[] };
  inputCharacters?: number;
  completionTokenCap?: number;
  requestTimeoutMs?: number;
  answer: string | null;
  checks: CheckResult[];
  manualReview: string[];
  latencyMs?: number;
  firstTokenMs?: number;
  error?: string;
}
export interface EvaluationReport {
  schemaVersion: 1;
  mode: 'live' | 'dry-run';
  startedAt: string;
  completedAt: string;
  configuration: EvaluationOptions;
  metadata: Record<string, string>;
  caveat: string;
  counters: { requests: number; reservedCompletionTokens: number; inputCharacters: number; passedChecks: number; failedChecks: number; completedTurns: number; failedTurns: number; skippedTurns: number };
  cases: Array<{ id: string; description: string; references: Array<ReferenceFixture & { available: boolean }>; turns: TurnResult[] }>;
}
export interface EvaluationDependencies {
  retrieve: (request: RetrievalRequest) => Promise<RetrievalResult>;
  stream: (messages: Message[], options: { signal: AbortSignal; maxTokens: number; reasoningEffort: 'low' | 'high' }) => Promise<ReadableStream<Uint8Array>>;
  decideReasoning: (message: string, history: Message[]) => { effort: 'low' | 'high'; reasons: readonly string[] };
  findReference: (id: string) => Chunk | undefined;
  now?: () => number;
  signal?: AbortSignal;
  metadata?: Record<string, string>;
  onProgress?: (progress: { caseId: string; turnId: string; phase: 'starting' | 'finished'; status: TurnResult['status']; latencyMs?: number; failedChecks?: number; effort?: 'low' | 'high'; completionTokenCap?: number }) => void;
}

export function checkAnswer(turn: EvaluationTurn, answer: string, sources: SourceReference[]): CheckResult[] {
  const citations = extractCitationIds(answer);
  const unknown = citations.filter(id => !sources.some(source => source.id === id));
  const results: CheckResult[] = [
    { id: 'answer-present', description: 'A nonempty user-facing answer was returned.', passed: Boolean(answer.trim()) },
    { id: 'citation-membership', description: 'Every bracketed source citation belongs to this turn’s retrieved evidence.', passed: unknown.length === 0, detail: unknown.length ? `Unknown references: ${[...new Set(unknown)].join(', ')}` : `${citations.length} citation(s); membership does not prove factual entailment.` },
  ];
  if (turn.requireCitation) results.push({ id: 'citation-present', description: 'The answer includes a retrieved-source citation.', passed: citations.some(id => sources.some(source => source.id === id)) });
  if (turn.expectedSourceIds?.length) {
    results.push({ id: 'reviewed-source-retrieved', description: 'At least one specifically reviewed reference was retrieved.', passed: turn.expectedSourceIds.some(id => sources.some(source => source.id === id)), detail: turn.expectedSourceIds.join(', ') });
    if (turn.requireCitation) results.push({ id: 'reviewed-source-cited', description: 'The answer cites a specifically reviewed reference retrieved this turn.', passed: turn.expectedSourceIds.some(id => citations.includes(id) && sources.some(source => source.id === id)) });
  }
  for (const rule of turn.checks) {
    const matched = rule.any.some(pattern => new RegExp(pattern, 'iu').test(answer));
    results.push({ id: rule.id, description: rule.description, passed: rule.absent ? !matched : matched });
  }
  return results;
}

export function referenceIsAvailable(reference: ReferenceFixture, chunk?: Chunk): boolean {
  const hash = reference.hashKind === 'checked-excerpt' ? chunk?.metadata.excerptHash : chunk?.metadata.sourceHash;
  return Boolean(chunk && hash === reference.sha256 && new RegExp(reference.passagePattern, 'iu').test(chunk.content));
}

/** Scrub reports and failures without ever serializing request headers or process.env. */
export function sanitizeEvaluationValue<T>(value: T, secrets: readonly string[]): T {
  const redact = (text: string) => {
    let clean = text;
    for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) clean = clean.split(secret).join('[REDACTED]');
    return clean.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk|sess)-[a-zA-Z0-9_-]{12,}/g, '[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  };
  const walk = (item: unknown): unknown => typeof item === 'string' ? redact(item)
    : Array.isArray(item) ? item.map(walk)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)])) : item;
  return walk(value) as T;
}

export async function runConversationEvaluation(cases: ConversationCase[], options: EvaluationOptions, dependencies: EvaluationDependencies): Promise<EvaluationReport> {
  // Re-validate programmatic callers as well as CLI input; callers cannot bypass caps.
  for (const [value, maximum] of [[options.maxRequests, EVALUATION_LIMITS.requests], [options.maxTokens, EVALUATION_LIMITS.tokensPerRequest], [options.maxTotalTokens, EVALUATION_LIMITS.totalCompletionTokens], [options.maxInputCharacters, EVALUATION_LIMITS.inputCharactersPerRequest], [options.maxTotalInputCharacters, EVALUATION_LIMITS.totalInputCharacters], [options.timeoutMs, EVALUATION_LIMITS.timeoutMs], [options.maxDurationMs, EVALUATION_LIMITS.totalTimeoutMs]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Evaluation limits exceed the allowed bounds.');
  }
  const now = dependencies.now ?? Date.now;
  const started = now();
  const report: EvaluationReport = {
    schemaVersion: 1, mode: options.live ? 'live' : 'dry-run', startedAt: new Date(started).toISOString(), completedAt: '',
    configuration: options, metadata: dependencies.metadata ?? {},
    caveat: 'These deterministic regression checks are not proof of factual correctness or general intelligence. Regex checks can miss paraphrases, contradictions and missing nuance. Inspect each public answer against the reviewed source and manual rubric. Dry-run history is simulated; no answers are generated or scored. Completion budgets are conservative reservations, not measured token usage or prices.',
    counters: { requests: 0, reservedCompletionTokens: 0, inputCharacters: 0, passedChecks: 0, failedChecks: 0, completedTurns: 0, failedTurns: 0, skippedTurns: 0 }, cases: [],
  };
  let consecutiveProviderFailures = 0;
  let stopped: string | undefined;
  for (const scenario of cases) {
    const references = scenario.references.map(reference => ({ ...reference, available: referenceIsAvailable(reference, dependencies.findReference(reference.id)) }));
    const result = { id: scenario.id, description: scenario.description, references, turns: [] as TurnResult[] };
    report.cases.push(result);
    const history: Message[] = [];
    let retainedSources: SourceReference[] = [];
    let previousFailed = false;
    let category = scenario.category;
    let mode = scenario.mode;
    for (const turn of scenario.turns) {
      category = turn.category ?? category; mode = turn.mode ?? mode;
      const boundedHistory = boundHistory(history.slice(-40));
      const record: TurnResult = { id: turn.id, status: 'planned', prompt: turn.prompt, category, mode, historyMessages: boundedHistory.length, retainedSourceIds: retainedSources.map(source => source.id), sources: [], answer: null, checks: [], manualReview: turn.manualReview };
      result.turns.push(record);
      if (dependencies.signal?.aborted) stopped = 'Evaluation canceled.';
      if (now() - started >= options.maxDurationMs) stopped = 'The total elapsed-time cap was reached.';
      if (stopped || previousFailed || references.some(reference => !reference.available)) {
        record.status = 'skipped'; record.error = stopped || (previousFailed ? 'An earlier turn in this conversation failed.' : 'A reviewed source fixture is unavailable or changed; review it before spending on this case.');
        report.counters.skippedTurns++;
        dependencies.onProgress?.({ caseId: scenario.id, turnId: turn.id, phase: 'finished', status: record.status });
        continue;
      }
      const began = now();
      let requestStarted = false;
      try {
        const retrieval = await dependencies.retrieve({ query: turn.prompt, category, history: boundedHistory, sourceIds: record.retainedSourceIds, maxChunks: 6 });
        record.sources = retrieval.sources; record.retrievalQuality = retrieval.quality;
        const decision = dependencies.decideReasoning(turn.prompt, boundedHistory);
        record.reasoning = { effort: decision.effort, reasons: [...decision.reasons] };
        const messages = buildCoachMessages({ category, mode, context: retrieval.context, sources: retrieval.sources, history: boundedHistory, message: turn.prompt, learningRecord: { completedExams: 0, weakTopics: [], recentMistakes: [], target: 90 } });
        const inputCharacters = messages.reduce((sum, message) => sum + message.content.length, 0);
        const completionTokenCap = Math.min(options.maxTokens, KIMI_REASONING_LIMITS[decision.effort].streamTokens);
        record.inputCharacters = inputCharacters; record.completionTokenCap = completionTokenCap;
        record.requestTimeoutMs = Math.min(options.timeoutMs, KIMI_REASONING_LIMITS[decision.effort].timeoutMs);
        if (!options.live) {
          record.checks = turn.expectedSourceIds?.length ? [{ id: 'reviewed-source-retrieved', description: 'Dry-run retrieval contains a specifically reviewed reference.', passed: turn.expectedSourceIds.some(id => retrieval.sources.some(source => source.id === id)) }] : [];
          history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.planningReply });
          retainedSources = retrieval.sources;
          continue;
        }
        const capReason = report.counters.requests >= options.maxRequests ? 'Request cap reached.'
          : report.counters.reservedCompletionTokens + completionTokenCap > options.maxTotalTokens ? 'Reserved completion-token cap reached.'
          : inputCharacters > options.maxInputCharacters ? 'This turn exceeds the input-character cap.'
          : report.counters.inputCharacters + inputCharacters > options.maxTotalInputCharacters ? 'Total input-character cap reached.' : undefined;
        if (capReason) { stopped = capReason; record.status = 'skipped'; record.error = capReason; report.counters.skippedTurns++; continue; }
        const remainingMs = options.maxDurationMs - (now() - started);
        if (remainingMs <= 0) { stopped = 'Total elapsed-time cap reached.'; record.status = 'skipped'; record.error = stopped; report.counters.skippedTurns++; continue; }
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(record.requestTimeoutMs, remainingMs)), ...(dependencies.signal ? [dependencies.signal] : [])]);
        report.counters.requests++; report.counters.reservedCompletionTokens += completionTokenCap; report.counters.inputCharacters += inputCharacters;
        requestStarted = true;
        record.answer = '';
        dependencies.onProgress?.({ caseId: scenario.id, turnId: turn.id, phase: 'starting', status: record.status, effort: decision.effort, completionTokenCap });
        try {
          const stream = await dependencies.stream(messages, { maxTokens: completionTokenCap, reasoningEffort: decision.effort, signal });
          for await (const delta of modelDeltas(stream)) {
            if (signal.aborted) throw new Error('Evaluation request stopped or timed out.');
            record.firstTokenMs ??= now() - began;
            if (record.answer.length + delta.length > EVALUATION_LIMITS.answerCharacters) throw new Error('The user-facing answer exceeded its character cap.');
            record.answer += delta;
          }
          if (signal.aborted) throw new Error('Evaluation request stopped or timed out.');
        } finally { controller.abort(); }
        record.status = 'complete'; record.checks = checkAnswer(turn, record.answer, retrieval.sources);
        history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: record.answer });
        retainedSources = retrieval.sources;
        consecutiveProviderFailures = 0;
        report.counters.completedTurns++;
      } catch (error) {
        record.status = 'failed'; record.error = error instanceof Error ? error.message : 'Evaluation turn failed.';
        record.checks.push({ id: 'complete-provider-response', description: 'The provider returned a complete, parseable response within the limits.', passed: false });
        report.counters.failedTurns++; previousFailed = true;
        if (requestStarted && ++consecutiveProviderFailures >= 2) stopped = 'Stopped after two consecutive provider failures; no automatic retry is attempted.';
      } finally {
        record.latencyMs = now() - began;
        report.counters.passedChecks += record.checks.filter(check => check.passed).length;
        report.counters.failedChecks += record.checks.filter(check => !check.passed).length;
        dependencies.onProgress?.({ caseId: scenario.id, turnId: turn.id, phase: 'finished', status: record.status, latencyMs: record.latencyMs, failedChecks: record.checks.filter(check => !check.passed).length });
      }
    }
  }
  report.completedAt = new Date(now()).toISOString();
  return report;
}

export function renderEvaluationMarkdown(report: EvaluationReport): string {
  const lines = [`# NOUR conversation evaluation (${report.mode})`, '', report.caveat, '', `Started: ${report.startedAt}`, `Completed: ${report.completedAt}`, '', '## Run bounds and outcome', '',
    `- Requests sent: ${report.counters.requests} / ${report.configuration.maxRequests}`,
    `- Reserved completion tokens: ${report.counters.reservedCompletionTokens} / ${report.configuration.maxTotalTokens}`,
    `- Input characters sent: ${report.counters.inputCharacters} / ${report.configuration.maxTotalInputCharacters}`,
    `- Complete / failed / skipped turns: ${report.counters.completedTurns} / ${report.counters.failedTurns} / ${report.counters.skippedTurns}`,
    `- Deterministic checks passed / failed: ${report.counters.passedChecks} / ${report.counters.failedChecks}`, '', '## Reproduction metadata', '', ...Object.entries(report.metadata).map(([key, value]) => `- ${key}: ${value}`)];
  const quote = (text: string) => text.split('\n').map(line => `> ${line}`).join('\n');
  for (const scenario of report.cases) {
    lines.push('', `## ${scenario.id}`, '', scenario.description, '', 'Reviewed references:', '', ...scenario.references.map(reference => `- ${reference.id}: ${reference.available ? 'fixture verified' : 'MISSING OR CHANGED'}; ${reference.expectedFact}`));
    for (const turn of scenario.turns) {
      lines.push('', `### ${turn.id}: ${turn.status}`, '', `Category: ${turn.category}; mode: ${turn.mode}; reasoning: ${turn.reasoning?.effort ?? 'not selected'}.`, `Total latency: ${turn.latencyMs ?? 0} ms; first public content: ${turn.firstTokenMs ?? 'n/a'} ms.`, '', 'Learner message:', '', quote(turn.prompt));
      if (turn.error) lines.push('', `Failure or skip: ${turn.error}`);
      if (turn.answer !== null) lines.push('', 'Raw user-facing answer (no application warning appended):', '', quote(turn.answer || '(empty)'));
      lines.push('', 'Deterministic checks:', '', ...turn.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.id}: ${check.description}${check.detail ? ` ${check.detail}` : ''}`), '', 'Manual review required:', '', ...turn.manualReview.map(item => `- ${item}`));
      lines.push('', 'Retrieved evidence:', '');
      for (const source of turn.sources) lines.push(`- ${source.id}: ${source.title}${source.page ? `, PDF page ${source.page}` : ''}, status ${source.status}`, '', quote(source.excerpt), '');
    }
  }
  return `${lines.join('\n')}\n`;
}
