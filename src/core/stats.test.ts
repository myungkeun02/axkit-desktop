import { describe, expect, it } from 'vitest';
import type { CardEvent } from './events';
import { approvalsSummary, mondayOf, monthChange, monthsBack, OTHER, spendBasis, spendingByMonth, teamWork, usageOverTime } from './stats';
import { Timeline } from './timeline';
import type { BotsView, CalendarView, SpendingView, UsageView } from './views';

const spend = (month: string, cats: [string, number][]): SpendingView => ({
  month, currency: 'KRW', total: cats.reduce((a, c) => a + c[1], 0), count: cats.length,
  byCategory: cats.map(([category, amount]) => ({ category, label: category.toUpperCase(), amount, count: 1 })),
});

describe('monthsBack', () => {
  it('goes back across a year', () => {
    expect(monthsBack('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('spendingByMonth', () => {
  it('keeps the top categories over the whole period and folds the rest', () => {
    const r = spendingByMonth([spend('2026-10', [['a', 100], ['b', 50], ['c', 5]]), spend('2026-11', [['b', 200], ['d', 3]])], 2);
    expect(r.series.map((s) => s.key)).toEqual(['b', 'a', OTHER]);
    expect(r.rows[0]).toMatchObject({ label: '10월', a: 100, b: 50, [OTHER]: 5, total: 155 });
    expect(r.rows[1]).toMatchObject({ a: 0, b: 200, [OTHER]: 3 });
  });
  it('has no 기타 when everything fits', () => {
    expect(spendingByMonth([spend('2026-11', [['a', 1]])]).series.map((s) => s.label)).toEqual(['A']);
  });
  it('compares with last month', () => {
    expect(monthChange(spend('2026-11', [['a', 150]]), spend('2026-10', [['a', 100]])).change).toBeCloseTo(0.5);
    expect(monthChange(spend('2026-11', [['a', 150]]), undefined).change).toBeNull();
  });
});

const usage = (daily: UsageView['daily']): UsageView => ({
  period: 'month', totals: { calls: 30, failures: 0, costUsd: 3 },
  byModel: [{ providerId: 'x', model: 'm1', calls: 20, costUsd: 2 }, { providerId: 'y', model: 'm2', calls: 10, costUsd: 1 }],
  byBot: [{ botId: 'main', name: '비서', calls: 30, costUsd: 3 }], daily,
});

describe('usageOverTime', () => {
  it('uses the per-day split when the server sends it', () => {
    const r = usageOverTime(usage([{ date: 'd1', calls: 3, costUsd: 0.3, byModel: { m1: { calls: 1, costUsd: 0.1 }, m2: { calls: 2, costUsd: 0.2 } } } as never]), 'model', 'costUsd');
    expect(r.estimated).toBe(false);
    expect(r.series.map((s) => s.key)).toEqual(['m1', 'm2']);
    expect(r.rows[0]).toMatchObject({ m1: 0.1, m2: 0.2 });
  });
  it('spreads each day by the period shares without it', () => {
    const r = usageOverTime(usage([{ date: 'd1', calls: 3, costUsd: 0.3 }]), 'model', 'costUsd');
    expect(r.estimated).toBe(true);
    expect(r.rows[0].m1).toBeCloseTo(0.2);
    expect(r.rows[0].m2).toBeCloseTo(0.1);
  });
  it('per bot, and folds beyond top', () => {
    const r = usageOverTime(usage([{ date: 'd1', calls: 3, costUsd: 0.3 }]), 'model', 'calls', 1);
    expect(r.series.map((s) => s.label)).toEqual(['m1', '기타']);
    expect(r.rows[0][OTHER]).toBeCloseTo(1);
    expect(usageOverTime(usage([]), 'bot', 'calls').series).toEqual([{ key: 'main', label: '비서' }]);
  });
});

describe('teamWork', () => {
  const bots: BotsView = { groups: [{ id: 'g', label: '한빛랩', bots: [{ id: 'dev', name: '개발 팀장', channel: 'dev', team: 'dev' }],
    teams: [{ id: 'dev', name: '개발팀', channel: 'dev', members: ['dev', 'dev-1'] }] }] };
  const cal: CalendarView = { month: '2026-11', days: [
    { date: '2026-11-17', events: [], done: [{ id: '1', title: 'a', at: '', bot: { id: 'dev-1', name: '' } }, { id: '2', title: 'b', at: '', bot: { id: 'main', name: '비서' } }] },
    { date: '2026-11-18', events: [], done: [{ id: '3', title: 'c', at: '', bot: { id: 'x', name: '' }, team: 'dev' } as never] },
    { date: '2026-11-01', events: [], done: [{ id: '4', title: 'd', at: '', bot: { id: 'dev', name: '' } }] },
  ] };
  it('counts per team inside the range, the assistant as 비서', () => {
    expect(teamWork([cal], bots, '2026-11-16', '2026-11-22')).toEqual([
      { teamId: 'dev', name: '개발팀', group: '한빛랩', count: 2 },
      { teamId: 'main', name: '비서', group: '', count: 1 },
    ]);
  });
});

describe('approvals', () => {
  it('finds the Monday', () => {
    expect(mondayOf('2026-11-19')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
  });
  it('uses the server history when present', () => {
    const weeks = [{ week: '2026-11-09', asked: 1, approved: 1, denied: 0, written: 0, auto: 5 }, { week: '2026-11-16', asked: 2, approved: 1, denied: 1, written: 0, auto: 9 }];
    const s = approvalsSummary({ history: { weeks } }, new Timeline(), '2026-11-19');
    expect(s.fromHistory).toBe(true);
    expect(s.thisWeek.auto).toBe(9);
  });
  it('counts this week from the timeline otherwise', () => {
    const t = new Timeline();
    const card = (seq: number, cardId: string, at: string): CardEvent => ({ type: 'card', seq, at, cardId, summary: 'q', effects: [], effectLabels: [] });
    t.apply(card(1, 'a', '2026-11-17T01:00:00Z'));
    t.apply(card(2, 'b', '2026-11-17T02:00:00Z'));
    t.apply(card(3, 'c', '2026-11-18T02:00:00Z'));
    t.apply(card(4, 'old', '2026-11-10T02:00:00Z'));
    t.apply({ type: 'card_closed', seq: 5, at: '', cardId: 'a', state: 'approved' });
    t.apply({ type: 'card_closed', seq: 6, at: '', cardId: 'b', state: 'closed', answer: '내일 해' });
    const s = approvalsSummary(null, t, '2026-11-19', { rules: [{ id: 'r', label: 'x', since: '2026-11-17T00:00:00Z', uses: 4 }, { id: 'o', label: 'y', since: '2026-10-01T00:00:00Z', uses: 90 }] });
    expect(s.fromHistory).toBe(false);
    expect(s.thisWeek).toEqual({ week: '2026-11-16', asked: 3, approved: 1, denied: 0, written: 1, auto: 4 });
  });
});

describe('spendBasis (이번 달 지출 근거)', () => {
  const view = (over: Partial<SpendingView> = {}): SpendingView => ({
    month: '2026-11', currency: 'KRW', total: 200_000, count: 3,
    byCategory: [{ category: 'shopping', label: '쇼핑', amount: 120_000, count: 1 }, { category: 'food', label: '식비', amount: 80_000, count: 2 }],
    entries: [
      { id: '1', date: '2026-11-20', merchant: '쿠팡', amount: 120_000, source: 'sms' },
      { id: '2', date: '2026-11-21', merchant: '김밥집', amount: 50_000, source: 'sms' },
      { id: '3', date: '2026-11-22', merchant: '카페', amount: 30_000, source: 'mail' },
    ],
    ...over,
  });
  it('says what was counted, the top category and the biggest spend', () => {
    expect(spendBasis(view())).toEqual({
      counted: '카드 알림·영수증 3건에서 셌어요 (카드 문자 2 · 메일 영수증 1)',
      top: '많이 쓴 곳: 쇼핑 60%',
      biggest: '가장 큰 지출: 쿠팡 12만원 (11/20)',
    });
  });
  it('falls back to recent when there are no entries', () => {
    const b = spendBasis(view({ entries: undefined, recent: [{ at: '2026-11-03T03:00:00Z', merchant: '마트', amount: 45_000 }] }));
    expect(b?.counted).toBe('카드 알림·영수증 3건에서 셌어요');
    expect(b?.biggest).toBe('가장 큰 지출: 마트 4만 5,000원 (11/3)');
  });
  it('is null when nothing was counted', () => {
    expect(spendBasis(view({ count: 0, total: 0, byCategory: [], entries: [] }))).toBeNull();
    expect(spendBasis(null)).toBeNull();
  });
});
