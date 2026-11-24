import { shiftMonth, ymd } from './format';
import type { Timeline } from './timeline';
import type { AutonomyView, BotsView, CalendarView, SpendingView, UsageView } from './views';

// Numbers for the 대시보드, from views that exist today plus the D8 additions (PROTOCOL-REQUESTS.md) when the server
// sends them. Pure functions: no I/O, tested in stats.test.ts.

/** D8 additions, all optional. */
export type Split = Record<string, { calls: number; costUsd: number }>;
export type UsageDaily = NonNullable<UsageView['daily']>[number] & { byModel?: Split; byBot?: Split };
export type DoneWithTeam = CalendarView['days'][number]['done'][number] & { team?: string };
export interface ApprovalWeek { week: string; asked: number; approved: number; denied: number; written: number; auto: number }
export interface ApprovalsHistory { history?: { weeks: ApprovalWeek[] } }

/** "2026-11", 3 → ["2026-09", "2026-10", "2026-11"] (oldest first). */
export function monthsBack(month: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(month, i - n + 1));
}

export interface Series { key: string; label: string }

// ---------- spending ----------

export const OTHER = 'other-folded';

export interface SpendingSeries {
  series: Series[];
  /** One row per month: { month, label, total, [category key]: amount }. */
  rows: Record<string, string | number>[];
}

/** Stacked by category over months. The top `top` categories by total over the period keep their own series (in a fixed
 * order: biggest first), the rest fold into "기타". Color follows the category, never its rank in one month. */
export function spendingByMonth(views: SpendingView[], top = 5): SpendingSeries {
  const totals = new Map<string, { label: string; amount: number }>();
  for (const v of views) for (const c of v.byCategory) {
    const t = totals.get(c.category) ?? { label: c.label, amount: 0 };
    t.amount += c.amount;
    totals.set(c.category, t);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const kept = ranked.slice(0, top).map(([key, t]) => ({ key, label: t.label }));
  const keptKeys = new Set(kept.map((k) => k.key));
  const folded = ranked.length > top;
  const series = folded ? [...kept, { key: OTHER, label: '기타' }] : kept;
  const rows = views.map((v) => {
    const row: Record<string, string | number> = { month: v.month, label: `${Number(v.month.slice(5))}월`, total: v.total };
    for (const s of series) row[s.key] = 0;
    for (const c of v.byCategory) {
      const key = keptKeys.has(c.category) ? c.category : OTHER;
      row[key] = (row[key] as number) + c.amount;
    }
    return row;
  });
  return { series, rows };
}

/** This month vs last month: { total, previous, change (ratio, null without a previous month) }. */
export function monthChange(current: SpendingView | undefined, previous: SpendingView | undefined) {
  const total = current?.total ?? 0;
  const prev = previous?.total ?? current?.previousTotal ?? 0;
  return { total, previous: prev, change: prev > 0 ? (total - prev) / prev : null };
}

// ---------- AI usage ----------

export type UsageBy = 'model' | 'bot';
export type UsageMeasure = 'costUsd' | 'calls';

export interface UsageSeries { series: Series[]; rows: Record<string, string | number>[]; estimated: boolean }

/** Per model or per bot over the days of a usage view. Uses the D8 split when present; without it each day is spread by
 * the period's shares (marked `estimated` so the screen can say so). Folds beyond `top` into "기타". */
export function usageOverTime(view: UsageView, by: UsageBy, measure: UsageMeasure, top = 5): UsageSeries {
  const totals = by === 'model'
    ? view.byModel.map((m) => ({ key: m.model, label: m.model, value: m[measure] }))
    : (view.byBot ?? []).map((b) => ({ key: b.botId, label: b.name, value: b[measure] }));
  const ranked = [...totals].sort((a, b) => b.value - a.value);
  const kept = ranked.slice(0, top);
  const keptKeys = new Set(kept.map((k) => k.key));
  const folded = ranked.length > top;
  const series: Series[] = [...kept.map(({ key, label }) => ({ key, label })), ...(folded ? [{ key: OTHER, label: '기타' }] : [])];
  const sum = totals.reduce((a, t) => a + t.value, 0);
  const daily = (view.daily ?? []) as UsageDaily[];
  let estimated = false;
  const rows = daily.map((d) => {
    const row: Record<string, string | number> = { date: d.date };
    for (const s of series) row[s.key] = 0;
    const split = by === 'model' ? d.byModel : d.byBot;
    if (split) {
      for (const [key, v] of Object.entries(split)) {
        const k = keptKeys.has(key) ? key : OTHER;
        if (k in row) row[k] = (row[k] as number) + v[measure];
      }
    } else if (sum > 0) {
      estimated = true;
      for (const t of totals) {
        const k = keptKeys.has(t.key) ? t.key : OTHER;
        row[k] = (row[k] as number) + (d[measure] * t.value) / sum;
      }
    }
    return row;
  });
  return { series, rows, estimated };
}

// ---------- teams ----------

export interface TeamWork { teamId: string; name: string; group: string; count: number }

/** Work done per team in [from, to] (YYYY-MM-DD, inclusive), from the calendar's 한 일. A bot's team comes from `done.team`
 * (D8) or the bots view; the assistant and bots without a team count as "비서". */
export function teamWork(calendars: CalendarView[], bots: BotsView | null | undefined, from: string, to: string): TeamWork[] {
  const teamOfBot = new Map<string, string>();
  const teamInfo = new Map<string, { name: string; group: string }>();
  for (const g of bots?.groups ?? []) {
    for (const t of g.teams ?? []) {
      teamInfo.set(t.id, { name: t.name, group: g.label });
      for (const m of t.members) teamOfBot.set(m, t.id);
    }
    for (const b of g.bots) if (b.team && !teamOfBot.has(b.id)) teamOfBot.set(b.id, b.team);
  }
  const counts = new Map<string, number>();
  for (const cal of calendars) for (const day of cal.days) {
    if (day.date < from || day.date > to) continue;
    for (const d of day.done as DoneWithTeam[]) {
      const team = d.team ?? (d.bot ? teamOfBot.get(d.bot.id) : undefined) ?? 'main';
      counts.set(team, (counts.get(team) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([teamId, count]) => ({ teamId, count, name: teamInfo.get(teamId)?.name ?? '비서', group: teamInfo.get(teamId)?.group ?? '' }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------- approvals ----------

/** Monday of the week containing `ymd` (dates are plain calendar days). */
export function mondayOf(ymd: string): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  const day = new Date(t).getUTCDay();
  return new Date(t - ((day + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

export interface ApprovalsSummary { weeks: ApprovalWeek[]; thisWeek: ApprovalWeek; fromHistory: boolean }

/** The server's weekly history (D8) when present; otherwise this week only, counted from the cards this app has seen
 * (opened this week, and how they closed) and, for `auto`, nothing — the rules view has only lifetime `uses`. */
export function approvalsSummary(history: ApprovalsHistory | null | undefined, timeline: Timeline, today: string, autonomy?: AutonomyView | null): ApprovalsSummary {
  const week = mondayOf(today);
  const weeks = history?.history?.weeks;
  if (weeks?.length) {
    const thisWeek = weeks.find((w) => w.week === week) ?? weeks[weeks.length - 1];
    return { weeks, thisWeek, fromHistory: true };
  }
  const kst = (iso: string) => ymd(Date.parse(iso));
  const w: ApprovalWeek = { week, asked: 0, approved: 0, denied: 0, written: 0, auto: 0 };
  for (const card of timeline.cards.values()) {
    if (mondayOf(kst(card.at)) !== week) continue;
    w.asked++;
    const closed = timeline.closed.get(card.cardId);
    if (!closed) continue;
    if (closed.answer && closed.state !== 'approved' && closed.state !== 'denied') w.written++;
    else if (closed.state === 'denied') w.denied++;
    else if (closed.state === 'approved') w.approved++;
  }
  // Rules made this week whose uses all fall in it are the only auto count we can be sure of.
  for (const r of autonomy?.rules ?? []) if (r.since && mondayOf(kst(r.since)) === week) w.auto += r.uses ?? 0;
  return { weeks: [w], thisWeek: w, fromHistory: false };
}
