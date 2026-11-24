// Korean wording for numbers and times, kept in one place so it is tested once. Dates and clocks follow the
// assistant's time zone from `GET status` (default Asia/Seoul), not the Mac's.

export const SEOUL = 'Asia/Seoul';
let zone = SEOUL;

/** Set from `status.assistant.timezone`. Unknown zones are ignored. */
export function setTimeZone(tz: string | undefined) {
  if (!tz) return;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } catch { /* keep the old one */ }
}
export const timeZone = () => zone;

const partsCache = new Map<string, Intl.DateTimeFormat>();
function parts(t: number): Record<string, number> {
  let f = partsCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    partsCache.set(zone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** How far the zone is ahead of UTC at that moment (ms). */
export function zoneOffset(t: number): number {
  const p = parts(t);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/** "YYYY-MM-DDTHH:mm" wall time in the zone (for <input type=datetime-local>). */
export const toZoneLocal = (t: number) => new Date(t + zoneOffset(t)).toISOString().slice(0, 16);

/** Wall time "YYYY-MM-DDTHH:mm" in the zone → the moment. */
export function fromZoneLocal(local: string): Date {
  const guess = Date.parse(`${local}:00Z`);
  const first = guess - zoneOffset(guess);
  return new Date(guess - zoneOffset(first));
}

const group = (n: number) => n.toLocaleString('ko-KR');

/** 12500 → "1만 2,500원", 980 → "980원", 1234567 → "123만 4,567원". */
export function won(amount: number): string {
  const negative = amount < 0;
  const value = Math.round(Math.abs(amount));
  const man = Math.floor(value / 10_000);
  const rest = value % 10_000;
  let text = man === 0 ? `${group(rest)}원` : rest === 0 ? `${group(man)}만원` : `${group(man)}만 ${group(rest)}원`;
  if (negative) text = '-' + text;
  return text;
}

/** Small API costs: "$0.42", "$0.003" → "1센트 미만". */
export function dollars(amount: number): string {
  if (amount > 0 && amount < 0.01) return '1센트 미만';
  return `$${amount.toFixed(2)}`;
}

export function money(amount: number, currency: string): string {
  if (currency.toUpperCase() === 'KRW') return won(amount);
  if (currency.toUpperCase() === 'USD') return dollars(amount);
  return `${amount.toFixed(2)} ${currency}`;
}

/** "2026-11-19" in the assistant's zone. */
export function ymd(date: Date | number): string {
  const t = typeof date === 'number' ? date : date.getTime();
  return new Date(t + zoneOffset(t)).toISOString().slice(0, 10);
}

const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

/** "방금", "5분 전", "3시간 전", "어제", "11월 3일". */
export function relative(date: Date | string | number, now: number = Date.now()): string {
  const t = toDate(date).getTime();
  const seconds = (now - t) / 1000;
  if (seconds < 60) return '방금';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (ymd(t) === ymd(now)) return `${Math.floor(seconds / 3600)}시간 전`;
  if (ymd(t) === ymd(now - 86_400_000)) return '어제';
  const [, m, d] = ymd(t).split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}

/** "오후 3:20" in the assistant's zone. */
export function clock(date: Date | string | number): string {
  const t = toDate(date).getTime();
  const k = new Date(t + zoneOffset(t));
  const h = k.getUTCHours();
  const m = k.getUTCMinutes();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

/** Subject particle by the last syllable: "개발 봇" → "개발 봇이", "비서" → "비서가". */
export function subject(name: string): string {
  const last = name.codePointAt(name.length - 1) ?? 0;
  if (last < 0xac00 || last > 0xd7a3) return name + '이(가)';
  return name + ((last - 0xac00) % 28 === 0 ? '가' : '이');
}

/** Object particle: "회의록" → "회의록을", "비서" → "비서를". */
export function object(name: string): string {
  const last = name.codePointAt(name.length - 1) ?? 0;
  if (last < 0xac00 || last > 0xd7a3) return name + '을(를)';
  return name + ((last - 0xac00) % 28 === 0 ? '를' : '을');
}

export function duration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 3600) return `${Math.max(Math.floor(s / 60), 1)}분`;
  if (s < 86_400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86_400)}일`;
}

/** "2026-11" → "2026년 11월". */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-');
  return `${y}년 ${Number(m)}월`;
}

/** Adds months to "YYYY-MM". */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Day cells for a month grid starting on Sunday: nulls before the 1st. */
export function monthCells(month: string): (number | null)[] {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
}

/** 48213 → "47KB", 2_400_000 → "2.3MB". */
export function fileSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** A coming moment: "오늘 오후 3:00", "내일 오전 9:00", "11월 21일 오후 3:00". */
export function upcoming(date: Date | string | number, now: number = Date.now()): string {
  const t = toDate(date).getTime();
  const day = ymd(t);
  if (day === ymd(now)) return `오늘 ${clock(t)}`;
  if (day === ymd(now + 86_400_000)) return `내일 ${clock(t)}`;
  const [, m, d] = day.split('-');
  return `${Number(m)}월 ${Number(d)}일 ${clock(t)}`;
}

/** "방금", "5분 전", "3시간 전", "1일 전", "12일 전" — for "언제 고쳤나". */
export function ago(date: Date | string | number, now: number = Date.now()): string {
  const t = toDate(date).getTime();
  const seconds = (now - t) / 1000;
  if (seconds < 60) return '방금';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86_400)}일 전`;
}

/** "11월 18일". */
export function monthDay(date: Date | string | number): string {
  const p = parts(new Date(date).getTime());
  return `${p.month}월 ${p.day}일`;
}

/** The line between days in a room: "오늘", "어제", "11월 18일 화요일", "2025년 12월 31일 수요일". */
export function dayLine(date: Date | string | number, now: number = Date.now()): string {
  const t = new Date(date).getTime();
  const a = parts(t);
  const n = parts(now);
  const key = (p: Record<string, number>) => Date.UTC(p.year, p.month - 1, p.day);
  const days = Math.round((key(n) - key(a)) / 86_400_000);
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  const week = '일월화수목금토'[new Date(key(a)).getUTCDay()];
  return `${a.year === n.year ? '' : `${a.year}년 `}${a.month}월 ${a.day}일 ${week}요일`;
}
