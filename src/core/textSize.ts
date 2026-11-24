// 글자 크기: a setting of this device only (never sent to the Mac). One number, `--font-scale`, sizes every word
// in the app; the CSS writes font sizes in rem and the root font size follows the scale.

export const TEXT_STEPS = [
  { scale: 0.875, label: '작게' },
  { scale: 1, label: '기본' },
  { scale: 1.125, label: '조금 크게' },
  { scale: 1.25, label: '크게' },
  { scale: 1.5, label: '아주 크게' },
] as const;

export const DEFAULT_STEP = 1;

/** A saved value (anything) → a valid step. */
export function stepOf(saved: unknown): number {
  const n = typeof saved === 'string' ? Number(saved) : saved;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < TEXT_STEPS.length ? n : DEFAULT_STEP;
}

/** ⌘+ / ⌘- / ⌘0 → the step to use (unchanged at either end), or null when the key is not one of them. */
export function stepForKey(step: number, e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): number | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === '=' || e.key === '+') return Math.min(step + 1, TEXT_STEPS.length - 1);
  if (e.key === '-' || e.key === '_') return Math.max(step - 1, 0);
  if (e.key === '0') return DEFAULT_STEP;
  return null;
}

export const percentLabel = (step: number) => `${Math.round(TEXT_STEPS[stepOf(step)].scale * 1000) / 10}%`;
