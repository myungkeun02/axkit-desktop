// §36 여러 캘린더: views/calendar may list `calendars` and tag events with `calendar` (name) and `account`.
// Every field is optional — an older server sends none of them, and then nothing here shows.

export interface CalendarInfo { id: string; name: string; primary?: boolean; writable?: boolean; description?: string; account?: string }

export const CALENDARS_LIMITED = '기본 캘린더만 보여요 — 비서 맥에서 ax-kit connect google을 한 번 더 해 주세요';

/** Only well-formed entries, in the server's order. */
export function decodeCalendars(raw: unknown): CalendarInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarInfo[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim()) continue;
    out.push({
      id: r.id, name: r.name.trim(), primary: r.primary === true, writable: r.writable === true,
      ...(typeof r.description === 'string' && r.description.trim() ? { description: r.description.trim() } : {}),
      ...(typeof r.account === 'string' && r.account.trim() ? { account: r.account.trim() } : {}),
    });
  }
  return out;
}

// No green: green means 한 일 on the same month grid.
const PALETTE = ['#007AFF', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA', '#5856D6', '#FF3B30', '#A2845E', '#FFCC00', '#30B0C7'];

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The same calendar id always gets the same color. */
export const calendarColor = (id: string) => PALETTE[fnv(id) % PALETTE.length];

/** Events carry the calendar's name (and account when there are several); find its id-based color. */
export function eventColor(e: { calendar?: string; account?: string }, calendars: CalendarInfo[]): string | undefined {
  if (!e.calendar) return undefined;
  const hit = calendars.find((c) => c.name === e.calendar && (!e.account || !c.account || c.account === e.account))
    ?? calendars.find((c) => c.name === e.calendar);
  return calendarColor(hit?.id ?? `${e.account ?? ''}/${e.calendar}`);
}

/** "업무" or "업무 · me@work" — empty when the server sent no calendar name. */
export const eventCalendarLabel = (e: { calendar?: string; account?: string }) =>
  e.calendar ? (e.account ? `${e.calendar} · ${e.account}` : e.calendar) : '';

/** Calendars an event can be added to: writable ones, primary first. */
export function writableCalendars(calendars: CalendarInfo[]): CalendarInfo[] {
  const w = calendars.filter((c) => c.writable);
  return [...w.filter((c) => c.primary), ...w.filter((c) => !c.primary)];
}

/** Name shown in the picker and legend; the account is added only when accounts differ. */
export function calendarName(c: CalendarInfo, calendars: CalendarInfo[]): string {
  const accounts = new Set(calendars.map((x) => x.account).filter(Boolean));
  return accounts.size > 1 && c.account ? `${c.name} · ${c.account}` : c.name;
}
