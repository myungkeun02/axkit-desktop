import { useSyncExternalStore } from 'react';
import { stepForKey, stepOf, TEXT_STEPS } from '../core/textSize';

// 글자 크기 for this device: kept in localStorage (never sent to the Mac), applied as `--font-scale` on <html>.
// The widget window shares the same storage, so a change in one window shows in the other (storage event).

const KEY = 'text-size';
const listeners = new Set<() => void>();

function read(): number {
  try { return stepOf(localStorage.getItem(KEY)); } catch { return stepOf(null); }
}

let current = read();

function apply(step: number) {
  document.documentElement.style.setProperty('--font-scale', String(TEXT_STEPS[step].scale));
}

export function setTextStep(step: number) {
  const s = stepOf(step);
  if (s === current) return;
  current = s;
  try { localStorage.setItem(KEY, String(s)); } catch { /* blocked: still applies until the app quits */ }
  apply(s);
  listeners.forEach((l) => l());
}

/** Once at start: apply the saved size, follow the other window, and take ⌘+ / ⌘- / ⌘0. */
export function startTextSize() {
  apply(current);
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    apply(current);
    listeners.forEach((l) => l());
  });
  window.addEventListener('keydown', (e) => {
    const next = stepForKey(current, e);
    if (next === null) return;
    e.preventDefault();
    setTextStep(next);
  });
}

export const useTextStep = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);
