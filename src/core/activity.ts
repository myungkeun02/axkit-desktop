// §4 `activity` (feature `activity`): the assistant is thinking or working in a room right now. Not in the log: no seq, never
// replayed, so it lives here and not in the Timeline. Pure logic with an injectable clock, so it is easy to test.

export type ActivityState = 'thinking' | 'working';

export interface RoomActivity {
  state: ActivityState;
  /** Plain words from the server ("메일 보는 중") while working. */
  step?: string;
  /** When the server said so (ms). */
  at: number;
  /** When the app forgets it without news (ms). */
  until: number;
}

export interface ActivityEvent {
  room: string;
  state: ActivityState | 'idle';
  step?: string;
  at: number;
}

/** No news for 3 minutes → forget it (the server forgets it then too). */
export const ACTIVITY_TTL_MS = 3 * 60_000;

/** `{type:"activity", channel?, state, step?, at}` → event, or null when it is not one we understand. */
export function decodeActivity(raw: unknown, now = Date.now()): ActivityEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'activity') return null;
  if (r.state !== 'thinking' && r.state !== 'working' && r.state !== 'idle') return null;
  const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? Date.parse(r.at) : now;
  const step = typeof r.step === 'string' && r.step.trim() ? r.step.trim() : undefined;
  return { room: typeof r.channel === 'string' ? r.channel : '', state: r.state, step, at };
}

/** "생각하는 중" or "메일 보는 중" (no trailing dots: the screen draws them moving). */
export function activityLine(a: RoomActivity): string {
  if (a.state === 'working' && a.step) return a.step.replace(/[.…\s]+$/, '');
  return a.state === 'working' ? '일하는 중' : '생각하는 중';
}

export class ActivityBoard {
  private rooms = new Map<string, RoomActivity>();

  /** Returns true when what the screen shows changed. */
  apply(e: ActivityEvent, now = Date.now()): boolean {
    if (e.state === 'idle') return this.rooms.delete(e.room);
    const before = this.rooms.get(e.room);
    // Clock skew between the Mac and this app must not shorten the 3 minutes: count from when it arrived.
    this.rooms.set(e.room, { state: e.state, step: e.step, at: e.at, until: now + ACTIVITY_TTL_MS });
    return !before || before.state !== e.state || before.step !== e.step;
  }

  /** The assistant answered in that room: the answer replaces the dots (unless it is older than the activity). */
  answered(room: string, at: number): boolean {
    const a = this.rooms.get(room);
    if (!a || at < a.at) return false;
    return this.rooms.delete(room);
  }

  get(room: string, now = Date.now()): RoomActivity | null {
    const a = this.rooms.get(room);
    if (!a) return null;
    if (a.until <= now) { this.rooms.delete(room); return null; }
    return a;
  }

  /** Every room still busy, newest first (the widget shows the newest one). */
  all(now = Date.now()): { room: string; activity: RoomActivity }[] {
    return [...this.rooms].filter(([, a]) => a.until > now).sort((x, y) => y[1].at - x[1].at).map(([room, activity]) => ({ room, activity }));
  }

  /** Drops what ran out; returns true when something did. */
  expire(now = Date.now()): boolean {
    let changed = false;
    for (const [room, a] of this.rooms) if (a.until <= now) { this.rooms.delete(room); changed = true; }
    return changed;
  }

  /** The next moment something runs out, or null. */
  nextExpiry(): number | null {
    let next: number | null = null;
    for (const a of this.rooms.values()) if (next === null || a.until < next) next = a.until;
    return next;
  }

  clear() { this.rooms.clear(); }
}
