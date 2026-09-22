export const CATEGORIES = ['NCA 2003', 'Spectrum', 'QoS/QoE', 'NIN-SIM & TIRMS', 'Emerging Tech', 'Institutional Governance', 'General'] as const;
export const MODES = ['Mode 1 (Teach)', 'Mode 2 (Drill/Quiz)'] as const;
export const MAX_MESSAGE_LENGTH = 8000;
export const MAX_HISTORY_MESSAGES = 40;

export function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
