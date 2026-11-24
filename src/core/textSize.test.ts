import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP, percentLabel, stepForKey, stepOf, TEXT_STEPS } from './textSize';

const key = (k: string, meta = true) => ({ key: k, metaKey: meta, ctrlKey: false, altKey: false });

describe('text size', () => {
  it('reads a saved step and falls back to 기본', () => {
    expect(stepOf('3')).toBe(3);
    expect(stepOf(4)).toBe(4);
    expect(stepOf('9')).toBe(DEFAULT_STEP);
    expect(stepOf(null)).toBe(DEFAULT_STEP);
    expect(stepOf('abc')).toBe(DEFAULT_STEP);
    expect(TEXT_STEPS[DEFAULT_STEP].scale).toBe(1);
  });

  it('⌘+ ⌘- ⌘0 move one step and stop at the ends', () => {
    expect(stepForKey(1, key('='))).toBe(2);
    expect(stepForKey(1, key('+'))).toBe(2);
    expect(stepForKey(4, key('='))).toBe(4);
    expect(stepForKey(1, key('-'))).toBe(0);
    expect(stepForKey(0, key('-'))).toBe(0);
    expect(stepForKey(4, key('0'))).toBe(1);
    expect(stepForKey(1, key('=', false))).toBeNull();
    expect(stepForKey(1, key('k'))).toBeNull();
  });

  it('shows the step as a percent', () => {
    expect(percentLabel(0)).toBe('87.5%');
    expect(percentLabel(4)).toBe('150%');
  });
});
