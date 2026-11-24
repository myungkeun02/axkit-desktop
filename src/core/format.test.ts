import { describe, expect, it } from 'vitest';
import { clock, dollars, fileSize, upcoming, fromZoneLocal, setTimeZone, toZoneLocal, monthCells, relative, shiftMonth, subject, won, ymd } from './format';

describe('format', () => {
  it('won', () => {
    expect(won(12500)).toBe('1만 2,500원');
    expect(won(980)).toBe('980원');
    expect(won(1234567)).toBe('123만 4,567원');
    expect(won(50000)).toBe('5만원');
    expect(won(-3000)).toBe('-3,000원');
  });
  it('dollars', () => {
    expect(dollars(0.42)).toBe('$0.42');
    expect(dollars(0.003)).toBe('1센트 미만');
  });
  it('KST dates and clock', () => {
    expect(ymd(Date.parse('2026-11-18T16:00:00Z'))).toBe('2026-11-19');
    expect(clock('2026-11-19T06:20:00Z')).toBe('오후 3:20');
    expect(clock('2026-11-18T15:05:00Z')).toBe('오전 12:05');
  });
  it('relative', () => {
    const now = Date.parse('2026-11-19T05:00:00Z');
    expect(relative(now - 10_000, now)).toBe('방금');
    expect(relative(now - 5 * 60_000, now)).toBe('5분 전');
    expect(relative(now - 3 * 3600_000, now)).toBe('3시간 전');
    expect(relative(now - 24 * 3600_000, now)).toBe('어제');
    expect(relative(Date.parse('2026-11-03T05:00:00Z'), now)).toBe('11월 3일');
  });
  it('particles', () => {
    expect(subject('개발 봇')).toBe('개발 봇이');
    expect(subject('비서')).toBe('비서가');
  });
  it('months', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    const cells = monthCells('2026-11'); // Nov 1 2026 is a Sunday
    expect(cells[0]).toBe(1);
    expect(cells.filter(Boolean)).toHaveLength(30);
  });
});

describe('time zone from the server', () => {
  it('follows status.assistant.timezone and goes back', () => {
    setTimeZone('America/New_York');
    expect(ymd(Date.parse('2026-11-19T03:00:00Z'))).toBe('2026-11-18');
    expect(clock('2026-11-19T15:30:00Z')).toBe('오전 10:30');
    expect(toZoneLocal(Date.parse('2026-07-01T16:00:00Z'))).toBe('2026-07-01T12:00');
    expect(fromZoneLocal('2026-07-01T12:00').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    setTimeZone('Not/AZone');
    expect(clock('2026-11-19T15:30:00Z')).toBe('오전 10:30');
    setTimeZone('Asia/Seoul');
    expect(fromZoneLocal('2026-11-20T09:00').toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(clock('2026-11-19T06:20:00Z')).toBe('오후 3:20');
  });
});

describe('fileSize', () => {
  it('reads plainly', () => {
    expect(fileSize(500)).toBe('500B');
    expect(fileSize(48213)).toBe('47KB');
    expect(fileSize(2_400_000)).toBe('2.3MB');
    expect(fileSize(undefined)).toBe('');
  });
});

describe('upcoming', () => {
  it('says today, tomorrow or the date', () => {
    const now = Date.parse('2026-11-19T01:00:00Z'); // 10:00 KST
    expect(upcoming('2026-11-19T06:00:00Z', now)).toBe('오늘 오후 3:00');
    expect(upcoming('2026-11-20T00:00:00Z', now)).toBe('내일 오전 9:00');
    expect(upcoming('2026-11-21T06:00:00Z', now)).toBe('11월 21일 오후 3:00');
  });
});
