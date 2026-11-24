import { describe, expect, it } from 'vitest';
import { bounds, formatDuration, leaveIn, leaveLine, modeLabel, pickRecommended, stops, type RouteOption } from './routes';

const opt = (mode: RouteOption['mode'], durationMin: number, extra: Partial<RouteOption> = {}): RouteOption =>
  ({ mode, durationMin, leaveAt: '2026-11-19T00:00:00Z', ...extra });

describe('routes', () => {
  it('formats durations', () => {
    expect(formatDuration(40)).toBe('40분');
    expect(formatDuration(65)).toBe('1시간 5분');
    expect(formatDuration(120)).toBe('2시간');
  });

  it('labels modes', () => {
    expect(modeLabel('transit')).toBe('대중교통');
    expect(modeLabel('car')).toBe('자동차');
    expect(modeLabel('walk')).toBe('걸어서');
  });

  it('picks the server choice, else fastest, else transit when close', () => {
    expect(pickRecommended([opt('car', 20), opt('transit', 40, { recommended: true })])?.mode).toBe('transit');
    expect(pickRecommended([opt('car', 20), opt('transit', 40)])?.mode).toBe('car');
    expect(pickRecommended([opt('car', 20), opt('transit', 24)])?.mode).toBe('transit');
    expect(pickRecommended([])).toBeUndefined();
  });

  it('says when to leave', () => {
    const now = Date.parse('2026-11-19T00:00:00Z');
    expect(leaveIn(opt('car', 1, { leaveAt: '2026-11-19T00:23:00Z' }), now)).toEqual({ minutes: 23, text: '23분 뒤 출발' });
    expect(leaveIn(opt('car', 1, { leaveAt: '2026-11-19T01:05:00Z' }), now).text).toBe('1시간 5분 뒤 출발');
    expect(leaveIn(opt('car', 1, { leaveAt: '2026-11-19T00:00:30Z' }), now).text).toBe('지금 나가야 해요');
    expect(leaveIn(opt('car', 1, { leaveAt: '2026-11-18T23:48:00Z' }), now)).toEqual({ minutes: -12, text: '12분 늦었어요' });
    // 00:12Z = 오전 9:12 KST
    expect(leaveLine(opt('car', 1, { leaveAt: '2026-11-19T00:12:00Z' }), Date.parse('2026-11-18T23:49:00Z'))).toBe('오전 9:12에 나가세요 · 23분 뒤');
  });

  it('computes bounds and stops', () => {
    expect(bounds([[127, 37.5], [126.9, 37.6], [NaN, 1]])).toEqual([[126.9, 37.5], [127, 37.6]]);
    expect(bounds([])).toBeNull();
    const home = { name: '집', lat: 1, lng: 1 }, a = { name: 'A', lat: 2, lng: 2 }, b = { name: 'B', lat: 3, lng: 3 };
    const view = { date: '', origin: home, legs: [
      { eventId: '1', title: 'a', arriveBy: '', from: home, to: a, options: [] },
      { eventId: '2', title: 'b', arriveBy: '', from: a, to: b, options: [] },
    ] };
    expect(stops(view).map((s) => s.name)).toEqual(['집', 'A', 'B']);
  });
});

describe('leaveLine on another day', () => {
  it('names the date instead of counting hours', () => {
    const opt = { mode: 'transit', durationMin: 46, distanceKm: 15, leaveAt: '2026-11-26T00:09:00Z', summary: '', steps: [], path: [] } as never;
    expect(leaveLine(opt, Date.parse('2026-11-19T08:00:00Z'))).toBe('11월 26일 오전 9:09에 나가세요');
    expect(leaveLine(opt, Date.parse('2026-11-27T08:00:00Z'))).toBe('11월 26일 오전 9:09 출발이었어요');
  });
});
