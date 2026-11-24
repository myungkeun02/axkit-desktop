import { clock, ymd } from './format';

// Places and routes (PROTOCOL-REQUESTS.md D7). The Mac finds coordinates and routes (카카오 + ODsay, keys in its
// Keychain); this app only draws them. Pure helpers here, tested in routes.test.ts.

export interface Geo { lat: number; lng: number; address?: string }
export interface Place extends Geo { name: string }

export type Mode = 'transit' | 'car' | 'walk';
export interface RouteStep { mode: 'walk' | 'subway' | 'bus' | 'car'; label: string; durationMin: number; line?: string; color?: string }
export interface RouteOption {
  mode: Mode;
  durationMin: number;
  distanceKm?: number;
  fareKrw?: number;
  tollKrw?: number;
  /** ISO: when to leave to arrive with a 5-minute buffer. */
  leaveAt: string;
  summary?: string;
  steps?: RouteStep[];
  /** [lng, lat] pairs. */
  path?: [number, number][];
  recommended?: boolean;
}
export interface RouteLeg { eventId: string; title: string; arriveBy: string; from: Place; to: Place; options: RouteOption[]; note?: string }
/** `origin: null` = the owner has not set home yet (§16): then `legs` is empty and `note` says so. */
export interface RoutesView { date: string; provider?: string; origin?: Place | null; legs: RouteLeg[]; note?: string }

export const modeLabel = (m: Mode | string): string => (m === 'transit' ? '대중교통' : m === 'car' ? '자동차' : m === 'walk' ? '걸어서' : m);

/** 65 → "1시간 5분", 40 → "40분", 120 → "2시간". */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}분`;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

/** The server's pick; else the fastest, preferring transit when within 5 minutes (cheaper). */
export function pickRecommended(options: RouteOption[]): RouteOption | undefined {
  if (!options.length) return undefined;
  const marked = options.find((o) => o.recommended);
  if (marked) return marked;
  const sorted = [...options].sort((a, b) => a.durationMin - b.durationMin);
  const fastest = sorted[0];
  const transit = options.find((o) => o.mode === 'transit');
  if (transit && transit.durationMin - fastest.durationMin <= 5) return transit;
  return fastest;
}

/** Minutes until leaving (negative = already late) and a plain line for it. */
export function leaveIn(option: RouteOption, now: number = Date.now()): { minutes: number; text: string } {
  const minutes = Math.round((Date.parse(option.leaveAt) - now) / 60_000);
  let text: string;
  if (minutes > 1 && minutes < 60) text = `${minutes}분 뒤 출발`;
  else if (minutes >= 60) text = `${formatDuration(minutes)} 뒤 출발`;
  else if (minutes > -2) text = '지금 나가야 해요';
  else text = `${formatDuration(-minutes)} 늦었어요`;
  return { minutes, text };
}

/** "오전 9:12에 나가세요 · 23분 뒤" — or just the leave time when it has passed long ago. */
export function leaveLine(option: RouteOption, now: number = Date.now()): string {
  const { minutes, text } = leaveIn(option, now);
  const at = `${clock(option.leaveAt)}에 나가세요`;
  // Another day: say the date, not "159시간 뒤".
  const day = ymd(Date.parse(option.leaveAt));
  if (day !== ymd(now)) {
    const [, m, d] = day.split('-').map(Number);
    return minutes > 0 ? `${m}월 ${d}일 ${at}` : `${m}월 ${d}일 ${clock(option.leaveAt)} 출발이었어요`;
  }
  if (minutes > 1) return `${at} · ${text.replace(' 출발', '')}`;
  if (minutes > -2) return `${at} · 지금이에요`;
  return `${at} · ${text}`;
}

/** [[minLng, minLat], [maxLng, maxLat]] around the points, or null when there are none. */
export function bounds(points: [number, number][]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** Every stop of the day in order: origin, then each leg's destination. */
export function stops(view: RoutesView): Place[] {
  const out: Place[] = [];
  const first = view.legs[0]?.from ?? view.origin;
  if (first) out.push(first);
  for (const leg of view.legs) out.push(leg.to);
  return out;
}

