import { describe, expect, it } from 'vitest';
import { ACTIVITY_TTL_MS, ActivityBoard, activityLine, decodeActivity } from './activity';

const at = (s: string) => Date.parse(`2026-11-20T05:00:${s}Z`);

describe('activity', () => {
  it('reads the stream shape', () => {
    expect(decodeActivity({ type: 'activity', state: 'thinking', at: '2026-11-20T05:00:00Z' })).toEqual({ room: '', state: 'thinking', step: undefined, at: at('00') });
    expect(decodeActivity({ type: 'activity', channel: 'dev', state: 'working', step: ' 메일 보는 중 ', at: '2026-11-20T05:00:01Z' }))
      .toEqual({ room: 'dev', state: 'working', step: '메일 보는 중', at: at('01') });
    expect(decodeActivity({ type: 'activity', state: 'sleeping' })).toBeNull();
    expect(decodeActivity({ type: 'message', state: 'idle' })).toBeNull();
  });

  it('shows thinking, then the step, and clears on idle', () => {
    const b = new ActivityBoard();
    const now = at('00');
    expect(b.apply({ room: '', state: 'thinking', at: now }, now)).toBe(true);
    expect(activityLine(b.get('', now)!)).toBe('생각하는 중');
    expect(b.apply({ room: '', state: 'working', step: '웹에서 찾아보는 중…', at: now + 1 }, now)).toBe(true);
    expect(activityLine(b.get('', now)!)).toBe('웹에서 찾아보는 중');
    expect(b.get('dev', now)).toBeNull();
    expect(b.apply({ room: '', state: 'idle', at: now + 2 }, now)).toBe(true);
    expect(b.get('', now)).toBeNull();
  });

  it('clears when the assistant answers in that room, but not for an older answer', () => {
    const b = new ActivityBoard();
    b.apply({ room: 'dev', state: 'thinking', at: at('10') }, at('10'));
    expect(b.answered('dev', at('05'))).toBe(false);
    expect(b.answered('', at('20'))).toBe(false);
    expect(b.answered('dev', at('20'))).toBe(true);
    expect(b.get('dev', at('20'))).toBeNull();
  });

  it('forgets after three minutes without news', () => {
    const b = new ActivityBoard();
    const now = at('00');
    b.apply({ room: '', state: 'thinking', at: now }, now);
    expect(b.nextExpiry()).toBe(now + ACTIVITY_TTL_MS);
    expect(b.expire(now + ACTIVITY_TTL_MS - 1)).toBe(false);
    expect(b.expire(now + ACTIVITY_TTL_MS)).toBe(true);
    expect(b.get('', now + ACTIVITY_TTL_MS)).toBeNull();
  });
});
