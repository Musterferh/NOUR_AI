export const REASONING_EFFORTS = ['low', 'high', 'max'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export type ReasoningReason = 'explicit-depth' | 'advanced-problem' | 'numerical-problem'
  | 'scenario-application' | 'comparison-analysis' | 'multi-part-analysis' | 'context-follow-up' | 'routine';
export interface ReasoningContextMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ReasoningDecision { effort: 'low' | 'high'; reasons: ReasoningReason[] }

function isFollowUp(text: string): boolean {
  return text.length <= 240 && (
    /^(?:why|how so|continue|go on|explain(?: further| more)?|tell me more|try again|(?:option |answer )?[a-d])\s*[?.!]*$/.test(text)
    || /^(?:why (?:is|was|would) (?:that|this|it|option [a-d])|what about (?:that|this|it|option [a-d])|explain (?:that|this|it|your answer)|i (?:still )?(?:don'?t|do not) understand)\b/.test(text)
  );
}

function difficultySignals(text: string): ReasoningReason[] {
  const reasons: ReasoningReason[] = [];
  if (/\b(?:think (?:harder|carefully|deeply)|reason carefully|in[- ]depth|step[- ]by[- ]step|deep(?:er)? (?:analysis|reasoning)|(?:hard|difficult|challenging|advanced|complex) (?:question|problem|scenario|case|exam))\b/.test(text)) reasons.push('explicit-depth');
  // Difficult vocabulary alone does not make a request to define it difficult.
  const definitionOnly = text.length <= 240
    && /^(?:please )?(?:define|give (?:me )?(?:a |the )?definition of|what (?:is|are)(?: the (?:meaning|definition) of)?)\s+[^.!?;:]+[.!?]*$/.test(text)
    && !/\b(?:and|then|why|how|if|when|should|would|best|apply|explain|justify|assess|analy[sz]e|compare|derive|prove|calculate)\b/.test(text);
  if (definitionOnly) return reasons;
  if (/\b(?:derive|prove|deduce|reconcile|evaluate|critically (?:assess|analy[sz]e)|trade[- ]offs?|counterexample|contradict(?:ion|ory))\b/.test(text)) reasons.push('advanced-problem');
  if (/\b(?:calculate|compute|solve|work out)\b/.test(text) && /\d|\b(?:formula|equation|percentage|ratio|probability|bandwidth|throughput|capacity|budget|cost)\b/.test(text)) reasons.push('numerical-problem');
  const declarativeScenario = /(?:^|[.!?]\s+)(?:a|an|the)\s+(?:(?:telecom|telecommunications|network|mobile|licensed|service)\s+){0,2}(?:licensee|operator|provider|regulator|commission|consumer|subscriber|company|firm|officer)\b/.test(text)
    && /\b(?:miss(?:es|ed)|fail(?:s|ed)|refus(?:es|ed)|request(?:s|ed)|disclos(?:es|ed)|shar(?:es|ed)|receiv(?:es|ed)|breach(?:es|ed)|violat(?:es|ed)|collect(?:s|ed)|den(?:ies|ied))\b/.test(text);
  if ((declarativeScenario || /\b(?:scenario|case study|suppose|assuming|assume|given that|what if|if a|if an|if the|when a|when an)\b/.test(text))
      && /\b(?:apply|applies|should|would|which|why|decide|recommend|assess|explain|calculate|determine|best|correct|lawful|legal|justified)\b/.test(text)) reasons.push('scenario-application');
  if (/\b(?:compare|contrast|distinguish|difference between)\b/.test(text)
      && /\b(?:justify|explain|implications?|application|overlap|why|trade[- ]offs?|advantages?|disadvantages?)\b/.test(text)) reasons.push('comparison-analysis');
  const tasks = new Set(text.match(/\b(?:analy[sz]e|assess|apply|compare|contrast|justify|explain|recommend|determine|calculate)\b/g) ?? []);
  if (tasks.size >= 2 && /\b(?:and|then|also)\b/.test(text)) reasons.push('multi-part-analysis');
  return reasons;
}

/** A bounded routing heuristic, not a model judgement. Reasons are fixed labels, never private reasoning. */
export function selectReasoningEffort(message: string, history: readonly ReasoningContextMessage[] = []): ReasoningDecision {
  const current = message.slice(0, 8000).toLowerCase().replace(/\s+/g, ' ').trim();
  const reasons = difficultySignals(current);
  if (reasons.length) return { effort: 'high', reasons };

  // Only referential follow-ups inherit difficulty. A fresh definition question
  // must not keep paying for a previous difficult conversation.
  if (isFollowUp(current)) {
    // Follow terse replies back to the latest standalone user turn, bounded
    // to six messages. A fresh ordinary topic stops the search.
    const recent: ReasoningContextMessage[] = [];
    for (let i = history.length - 1; i >= Math.max(0, history.length - 6); i--) {
      const item = history[i];
      if (item.role === 'system') continue;
      recent.unshift(item);
      if (item.role === 'user' && !isFollowUp(item.content.slice(0, 8000).toLowerCase().replace(/\s+/g, ' ').trim())) break;
    }
    const inherited = difficultySignals(recent.map(item => item.content.slice(0, 2400).toLowerCase()).join(' '));
    if (inherited.length) return { effort: 'high', reasons: [...inherited, 'context-follow-up'] };
  }
  return { effort: 'low', reasons: ['routine'] };
}
