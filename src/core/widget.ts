// The widget (menu bar drop-down / pinned floating window): what it shows, picked from data the app already has —
// `views/today`, the open 결재 in the timeline, the newest notices and the §4 activity board. Pure, so it is easy to test.

import { activityLine, type ActivityBoard } from './activity';
import { subject } from './format';
import type { Timeline } from './timeline';
import type { TodayView } from './views';

export const SHOW = { events: 3, todos: 3, notes: 2 } as const;

export interface Shown<T> { items: T[]; more: number }

const cut = <T>(list: T[], n: number): Shown<T> => ({ items: list.slice(0, n), more: Math.max(list.length - n, 0) });

/** Today's events that have not ended yet (all-day ones first), at most three. */
export function nextEvents(today: TodayView | null, now = Date.now()): Shown<NonNullable<TodayView['events']>[number]> {
  const left = (today?.events ?? []).filter((e) => e.allDay || Date.parse(e.end ?? e.start) >= now || !Number.isFinite(Date.parse(e.end ?? e.start)));
  left.sort((a, b) => (a.allDay === b.allDay ? Date.parse(a.start) - Date.parse(b.start) : a.allDay ? -1 : 1));
  return cut(left, SHOW.events);
}

export const todoLines = (today: TodayView | null) => cut(today?.todos ?? [], SHOW.todos);

/** One line of plain text: no markdown marks, spaces folded, at most `max` characters. */
export function plainLine(text: string, max = 90): string {
  const plain = text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...plain].length > max ? `${[...plain].slice(0, max).join('')}…` : plain;
}

export interface Note { seq: number; room: string; text: string; at: string }

/** The newest notices (any room), newest first. Assistant replies are chat, not 알림. */
export function recentNotes(timeline: Timeline, n: number = SHOW.notes): Note[] {
  const out: Note[] = [];
  for (const room of timeline.roomIds) {
    for (const it of timeline.items(room)) {
      if (it.kind === 'notice' && it.event.text.trim()) out.push({ seq: it.seq, room, text: plainLine(it.event.text), at: it.event.at });
    }
  }
  return out.sort((a, b) => b.seq - a.seq).slice(0, n);
}

/** "비서가 생각하는 중" / "디자인팀 · 메일 보는 중", or null when nobody is busy. */
export function busyLine(board: ActivityBoard, title: (room: string) => string, assistant: string, now = Date.now()): string | null {
  const [first, ...rest] = board.all(now);
  if (!first) return null;
  const what = activityLine(first.activity);
  const who = first.room ? title(first.room) : assistant;
  const line = first.room ? `${who} · ${what}` : `${subject(who)} ${what}`;
  return rest.length ? `${line} 외 ${rest.length}곳` : line;
}

/** 결재 waiting: what the timeline holds open, or the today view's count before the log has loaded. */
export const waitingCards = (timeline: Timeline, today: TodayView | null, now = Date.now()) =>
  timeline.lastSeq > 0 ? timeline.openCards(now).length : (today?.pendingCards ?? 0);
