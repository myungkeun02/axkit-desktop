import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../app/context';
import { hasView } from '../core/api';
import { dollars, won, ymd } from '../core/format';
import {
  approvalsSummary, monthChange, monthsBack, mondayOf, spendingByMonth, teamWork, usageOverTime,
  type ApprovalsHistory, type Series, type UsageBy, type UsageMeasure,
} from '../core/stats';
import type { AutonomyView, CalendarView, SpendingView, UsageView } from '../core/views';
import { Button, Loaded, Segmented, Spinner, useLoad, type Loadable } from '../ui/kit';
import '../ui/dashboard.css';

// 대시보드: spending by month and category, AI cost over time per model or bot, work per team, and how many 결재 were
// asked vs done on its own. Each card shows only when its view exists on this Mac.

const SLOTS = 6;
const KRW_PER_USD = 1400;

/** Chart colors from the CSS tokens in dashboard.css, re-read when light/dark changes. */
function useChartColors(root: React.RefObject<HTMLElement | null>) {
  const read = () => {
    const el = root.current;
    const css = el ? getComputedStyle(el) : null;
    const v = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
    return {
      series: Array.from({ length: SLOTS }, (_, i) => v(`--series-${i + 1}`, '#2a78d6')),
      surface: v('--chart-surface', '#ffffff'),
      grid: v('--chart-grid', '#e1e0d9'),
      axis: v('--chart-axis', '#c3c2b7'),
      muted: v('--chart-muted', '#898781'),
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    setColors(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setColors(read());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return colors;
}
type Colors = ReturnType<typeof useChartColors>;

const modelName = (id: string) => id.split('-').filter(Boolean).reduce<string[]>((out, p, i, all) => {
  const known: Record<string, string> = { gpt: 'GPT', deepseek: 'DeepSeek', claude: 'Claude', gemini: 'Gemini', mini: 'mini', nano: 'nano', pro: 'Pro' };
  if (/^\d+$/.test(p) && /^\d+$/.test(all[i - 1] ?? '')) out[out.length - 1] += `.${p}`;
  else out.push(known[p.toLowerCase()] ?? (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)));
  return out;
}, []).join(' ');

/** Compact Korean amounts for axes: 0 / 5만 / 120만. */
const wonAxis = (v: number) => (v === 0 ? '0' : v >= 10_000 ? `${Math.round(v / 10_000).toLocaleString('ko-KR')}만` : v.toLocaleString('ko-KR'));
const pct = (r: number) => `${Math.round(Math.abs(r) * 100)}%`;

export function Dashboard() {
  const { session } = useApp();
  const root = useRef<HTMLDivElement>(null);
  const colors = useChartColors(root);
  const caps = session.capabilities;
  const today = ymd(Date.now());
  const month = today.slice(0, 7);
  const has = (v: string) => hasView(caps, v);

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>대시보드</h1>
        <div className="side right" />
      </header>
      <div className="scroll">
        <div className="page wide dash" ref={root} style={{ maxWidth: 1180 }}>
          <Tiles today={today} />
          <div className="grid">
            {has('spending') && <SpendingCard month={month} colors={colors} />}
            {has('usage') && <UsageCard colors={colors} />}
            {has('calendar') && <TeamCard today={today} colors={colors} />}
            {(has('approvals') || has('autonomy')) && <ApprovalsCard today={today} colors={colors} />}
          </div>
          {!has('spending') && !has('usage') && !has('calendar') && !has('approvals') && (
            <div className="secondary" style={{ textAlign: 'center', padding: 40 }}>맥에 아직 통계로 보여 줄 기능이 없어요.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------- tiles ----------

function Tile({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="tile"><div className="k">{k}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
}

function Tiles({ today }: { today: string }) {
  const { session } = useApp();
  const caps = session.capabilities;
  const month = today.slice(0, 7);
  const [spend] = useLoad(async () => {
    if (!hasView(caps, 'spending')) return null;
    const [cur, prev] = await Promise.all(monthsBack(month, 2).reverse().map((m) => session.api.view<SpendingView>('spending', { month: m })));
    return monthChange(cur, prev);
  }, [caps, month]);
  const [ai] = useLoad(() => (hasView(caps, 'usage') ? session.api.view<UsageView>('usage', { period: 'month' }) : Promise.resolve(null)), [caps]);
  const [appr] = useLoad(async () => {
    const [hist, auto] = await Promise.all([
      hasView(caps, 'approvals') ? session.api.view<ApprovalsHistory>('approvals').catch(() => null) : null,
      hasView(caps, 'autonomy') ? session.api.view<AutonomyView>('autonomy').catch(() => null) : null,
    ]);
    return approvalsSummary(hist, session.timeline, today, auto);
  }, [caps, today]);
  const [work] = useLoad(async () => {
    if (!hasView(caps, 'calendar')) return null;
    const monday = mondayOf(today);
    const months = [...new Set([monday.slice(0, 7), month])];
    const cals = await Promise.all(months.map((m) => session.api.view<CalendarView>('calendar', { month: m })));
    return teamWork(cals, session.bots, monday, today);
  }, [caps, today, session.bots]);

  const val = <T,>(l: Loadable<T | null>, f: (v: T) => ReactNode) => (l.state === 'loaded' ? (l.value === null ? null : f(l.value)) : l.state === 'loading' ? <Spinner /> : '—');
  const tiles: ReactNode[] = [];
  if (hasView(caps, 'spending')) {
    tiles.push(<Tile key="s" k="이번 달 지출" v={val(spend, (s) => won(s.total))}
      s={spend.state === 'loaded' && spend.value?.previous ? `지난달 전체 ${won(spend.value.previous)}의 ${Math.round((spend.value.total / spend.value.previous) * 100)}%` : '지난달 기록 없음'} />);
  }
  if (hasView(caps, 'usage')) {
    tiles.push(<Tile key="a" k="AI 비용 이번 달" v={val(ai, (u) => dollars(u.totals.costUsd))}
      s={ai.state === 'loaded' && ai.value ? `약 ${won(ai.value.totals.costUsd * KRW_PER_USD)} · ${ai.value.totals.calls.toLocaleString('ko-KR')}번 물어봄` : undefined} />);
  }
  tiles.push(<Tile key="r" k="결재 이번 주" v={val(appr, (a) => `${a.thisWeek.asked}번 물어봄`)}
    s={appr.state === 'loaded' && appr.value ? `알아서 한 일 ${appr.value.thisWeek.auto}건` : undefined} />);
  if (hasView(caps, 'calendar')) {
    tiles.push(<Tile key="t" k="이번 주 팀들이 한 일" v={val(work, (w) => `${w.reduce((a, t) => a + t.count, 0)}건`)}
      s={work.state === 'loaded' && work.value?.length ? `가장 많이: ${work.value[0].name} ${work.value[0].count}건` : undefined} />);
  }
  return <div className="tiles">{tiles}</div>;
}

// ---------- shared chart pieces ----------

function ChartCard({ title, sub, controls, children, table, note }: { title: string; sub?: string; controls?: ReactNode; children: ReactNode; table: ReactNode; note?: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="chart-card" aria-label={title}>
      <div className="chart-head">
        <div className="titles"><div className="title" role="heading" aria-level={3}>{title}</div>{sub && <div className="sub">{sub}</div>}</div>
        <div className="controls">{controls}</div>
      </div>
      {asTable ? <div className="table-wrap">{table}</div> : children}
      <div className="foot">
        {note && <span>{note}</span>}
        <Button kind="plain" small onClick={() => setAsTable(!asTable)}>{asTable ? '그래프로 보기' : '표로 보기'}</Button>
      </div>
    </section>
  );
}

function Legend({ series, colors }: { series: Series[]; colors: Colors }) {
  if (series.length < 2) return null;
  return <div className="legend">{series.map((s, i) => <span key={s.key}><i className="sw" style={{ background: colors.series[i % SLOTS] }} />{s.label}</span>)}</div>;
}

interface TipProps { active?: boolean; label?: string | number; payload?: { dataKey?: string | number; value?: number; color?: string }[] }

function Tip({ active, label, payload, series, fmt, title, total }: TipProps & { series: Series[]; fmt: (v: number) => string; title?: (l: string) => string; total?: boolean }) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p]));
  const rows = [...series].reverse().map((s) => ({ s, p: byKey.get(s.key) })).filter((r) => r.p && (r.p.value ?? 0) > 0);
  const sum = rows.reduce((a, r) => a + (r.p!.value ?? 0), 0);
  return (
    <div className="tip">
      <div className="h">{title ? title(String(label)) : String(label)}</div>
      {rows.map(({ s, p }) => (
        <div key={s.key} className="r"><i className="sw" style={{ background: p!.color }} /><span className="n">{s.label}</span><span className="x">{fmt(p!.value ?? 0)}</span></div>
      ))}
      {total && rows.length > 1 && <div className="t"><span className="secondary">합계</span><span className="x">{fmt(sum)}</span></div>}
    </div>
  );
}

/** Recharts' content prop wants its own props type; ours reads the same fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tip = (render: (p: TipProps) => ReactNode) => (p: any) => render(p as TipProps);

const axisProps = (colors: Colors) => ({ stroke: colors.axis, tick: { fill: colors.muted, fontSize: 11 }, tickLine: false });

/** Rounded data-end on the top segment of a stack only. */
const radiusFor = (i: number, n: number): [number, number, number, number] => (i === n - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]);

// ---------- 월별 지출 ----------

function SpendingCard({ month, colors }: { month: string; colors: Colors }) {
  const { session } = useApp();
  const [n, setN] = useState<'3' | '6' | '12'>('6');
  const [state, reload] = useLoad(() => Promise.all(monthsBack(month, Number(n)).map((m) => session.api.view<SpendingView>('spending', { month: m }))), [month, n]);
  return (
    <Loaded value={state} retry={reload}>
      {(views) => {
        const { series, rows } = spendingByMonth(views);
        const empty = rows.every((r) => !r.total);
        return (
          <ChartCard title="월별 지출" sub="분류별로 쌓았어요 (원)"
            controls={<Segmented value={n} onChange={setN} options={[{ id: '3', label: '3개월' }, { id: '6', label: '6개월' }, { id: '12', label: '1년' }]} />}
            table={<table className="data"><thead><tr><th>달</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}<th>합계</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={String(r.month)}><td>{r.label}</td>{series.map((s) => <td key={s.key}>{won(r[s.key] as number)}</td>)}<td>{won(r.total as number)}</td></tr>)}</tbody></table>}>
            {empty ? <div className="chart center-fill">이 기간에는 지출 기록이 없어요</div> : (
              <>
                <div className="chart">
                  <ResponsiveContainer>
                    <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="label" {...axisProps(colors)} />
                      <YAxis tickFormatter={wonAxis} {...axisProps(colors)} axisLine={false} width={44} />
                      <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={tip((p) => <Tip {...p} series={series} fmt={won} total />)} />
                      {series.map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} name={s.label} stackId="m" fill={colors.series[i % SLOTS]} stroke={colors.surface} strokeWidth={1}
                          maxBarSize={24} radius={radiusFor(i, series.length)} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Legend series={series} colors={colors} />
              </>
            )}
          </ChartCard>
        );
      }}
    </Loaded>
  );
}

// ---------- AI 비용 추이 ----------

function UsageCard({ colors }: { colors: Colors }) {
  const { session } = useApp();
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [by, setBy] = useState<UsageBy>('model');
  const [measure, setMeasure] = useState<UsageMeasure>('costUsd');
  const [state, reload] = useLoad(() => session.api.view<UsageView>('usage', { period }), [period]);
  const fmt = measure === 'costUsd' ? (v: number) => (v > 0 && v < 0.01 ? '1센트 미만' : `$${v.toFixed(2)}`) : (v: number) => `${Math.round(v).toLocaleString('ko-KR')}번`;
  return (
    <Loaded value={state} retry={reload}>
      {(u) => {
        const data = usageOverTime(u, by, measure);
        const series = data.series.map((s) => ({ ...s, label: by === 'model' && s.key !== 'other-folded' ? modelName(s.label) : s.label }));
        const day = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
        return (
          <ChartCard title="AI 비용 추이" sub={`${by === 'model' ? '모델별' : '봇별'} · ${measure === 'costUsd' ? '쓴 돈(달러)' : '물어본 횟수'}`}
            controls={<>
              <Segmented value={by} onChange={setBy} options={[{ id: 'model', label: '모델별' }, { id: 'bot', label: '봇별' }]} />
              <Segmented value={measure} onChange={setMeasure} options={[{ id: 'costUsd', label: '비용' }, { id: 'calls', label: '횟수' }]} />
              <Segmented value={period} onChange={setPeriod} options={[{ id: 'week', label: '7일' }, { id: 'month', label: '이번 달' }]} />
            </>}
            note={data.estimated ? '날짜별 나눔은 맥이 아직 보내지 않아 기간 비율로 나눠 그렸어요.' : undefined}
            table={<table className="data"><thead><tr><th>날짜</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
              <tbody>{data.rows.map((r) => <tr key={String(r.date)}><td>{day(String(r.date))}</td>{series.map((s) => <td key={s.key}>{fmt(r[s.key] as number)}</td>)}</tr>)}</tbody></table>}>
            {data.rows.length === 0 ? <div className="chart center-fill">이 기간에는 기록이 없어요</div> : (
              <>
                <div className="chart">
                  <ResponsiveContainer>
                    <AreaChart data={data.rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="date" tickFormatter={(d: string) => `${Number(d.slice(8, 10))}일`} {...axisProps(colors)} minTickGap={24} />
                      <YAxis tickFormatter={measure === 'costUsd' ? (v: number) => `$${v}` : (v: number) => v.toLocaleString('ko-KR')} {...axisProps(colors)} axisLine={false} width={44} />
                      <Tooltip cursor={{ stroke: colors.axis, strokeWidth: 1 }} content={tip((p) => <Tip {...p} series={series} fmt={fmt} title={day} total />)} />
                      {series.map((s, i) => (
                        <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId="u" stroke={colors.series[i % SLOTS]} strokeWidth={2}
                          fill={colors.series[i % SLOTS]} fillOpacity={0.12} isAnimationActive={false} activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <Legend series={series} colors={colors} />
              </>
            )}
          </ChartCard>
        );
      }}
    </Loaded>
  );
}

// ---------- 팀별 한 일 ----------

function TeamCard({ today, colors }: { today: string; colors: Colors }) {
  const { session } = useApp();
  const [range, setRange] = useState<'week' | 'month'>('week');
  const from = range === 'week' ? mondayOf(today) : `${today.slice(0, 7)}-01`;
  const [state, reload] = useLoad(async () => {
    const months = [...new Set([from.slice(0, 7), today.slice(0, 7)])];
    return Promise.all(months.map((m) => session.api.view<CalendarView>('calendar', { month: m })));
  }, [from, today]);
  return (
    <Loaded value={state} retry={reload}>
      {(cals) => {
        const rows = teamWork(cals, session.bots, from, today).map((t) => ({ ...t, label: t.group ? `${t.name} · ${t.group}` : t.name }));
        return (
          <ChartCard title="팀별 한 일" sub="캘린더의 '한 일'을 팀마다 셌어요 (건)"
            controls={<Segmented value={range} onChange={setRange} options={[{ id: 'week', label: '이번 주' }, { id: 'month', label: '이번 달' }]} />}
            table={<table className="data"><thead><tr><th>팀</th><th>회사</th><th>한 일</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.teamId}><td>{r.name}</td><td>{r.group || '—'}</td><td>{r.count}건</td></tr>)}</tbody></table>}>
            {rows.length === 0 ? <div className="chart center-fill">이 기간에 팀들이 한 일이 없어요</div> : (
              <div className="chart" style={{ height: Math.max(160, rows.length * 34 + 20) }}>
                <ResponsiveContainer>
                  <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 0 }}>
                    <CartesianGrid horizontal={false} stroke={colors.grid} />
                    <XAxis type="number" allowDecimals={false} {...axisProps(colors)} />
                    <YAxis type="category" dataKey="name" width={84} {...axisProps(colors)} axisLine={false} />
                    <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={tip(({ active, payload }) => {
                      const row = (payload?.[0] as { payload?: { label: string; count: number } } | undefined)?.payload;
                      return active && row ? <div className="tip"><div className="h">{row.label}</div><div className="r"><span className="n">한 일</span><span className="x">{row.count}건</span></div></div> : null;
                    })} />
                    <Bar dataKey="count" fill={colors.series[0]} maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                      <LabelList dataKey="count" position="right" fill={colors.muted} fontSize={11} formatter={(v: unknown) => `${v}건`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        );
      }}
    </Loaded>
  );
}

// ---------- 결재 ----------

const APPROVAL_SERIES: Series[] = [
  { key: 'approved', label: '승인' },
  { key: 'denied', label: '안 함' },
  { key: 'written', label: '직접 답함' },
  { key: 'auto', label: '알아서 한 일' },
];

function ApprovalsCard({ today, colors }: { today: string; colors: Colors }) {
  const { session } = useApp();
  const caps = session.capabilities;
  const [state, reload] = useLoad(async () => {
    const [hist, auto] = await Promise.all([
      hasView(caps, 'approvals') ? session.api.view<ApprovalsHistory>('approvals').catch(() => null) : null,
      hasView(caps, 'autonomy') ? session.api.view<AutonomyView>('autonomy').catch(() => null) : null,
    ]);
    return { hist, auto };
  }, [caps]);
  const label = (w: string) => `${Number(w.slice(5, 7))}/${Number(w.slice(8, 10))}`;
  const weekTitle = (w: string) => `${Number(w.slice(5, 7))}월 ${Number(w.slice(8, 10))}일 주`;
  const summary = useMemo(() => (state.state === 'loaded' ? approvalsSummary(state.value.hist, session.timeline, today, state.value.auto) : null),
    // the timeline changes in place; version keeps this fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, today, session.version]);
  return (
    <Loaded value={state} retry={reload}>
      {() => {
        const s = summary!;
        const rows = s.weeks.map((w) => ({ ...w, label: label(w.week) }));
        const share = s.thisWeek.asked + s.thisWeek.auto > 0 ? s.thisWeek.auto / (s.thisWeek.asked + s.thisWeek.auto) : 0;
        return (
          <ChartCard title="결재와 알아서 한 일" sub={`이번 주: 물어본 것 ${s.thisWeek.asked}건, 묻지 않고 한 것 ${s.thisWeek.auto}건 (${pct(share)})`}
            note={s.fromHistory ? undefined : '주별 기록은 맥이 아직 보내지 않아 이번 주만, 이 앱이 본 결재로 셌어요.'}
            table={<table className="data"><thead><tr><th>주</th><th>물어본 것</th>{APPROVAL_SERIES.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={r.week}><td>{weekTitle(r.week)}</td><td>{r.asked}</td>{APPROVAL_SERIES.map((x) => <td key={x.key}>{r[x.key as keyof typeof r]}</td>)}</tr>)}</tbody></table>}>
            <div className="chart">
              <ResponsiveContainer>
                <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={4}>
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="label" {...axisProps(colors)} />
                  <YAxis allowDecimals={false} {...axisProps(colors)} axisLine={false} width={32} />
                  <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }}
                    content={tip((p) => <Tip {...p} series={APPROVAL_SERIES} fmt={(v) => `${v}건`} title={(l) => { const r = rows.find((x) => x.label === l); return r ? weekTitle(r.week) : l; }} />)} />
                  {APPROVAL_SERIES.slice(0, 3).map((x, i) => (
                    <Bar key={x.key} dataKey={x.key} name={x.label} stackId="asked" fill={colors.series[i]} stroke={colors.surface} strokeWidth={1}
                      maxBarSize={20} radius={radiusFor(i, 3)} isAnimationActive={false} />
                  ))}
                  <Bar dataKey="auto" name="알아서 한 일" stackId="auto" fill={colors.series[3]} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="legend">
              {APPROVAL_SERIES.map((x, i) => <span key={x.key}><i className="sw" style={{ background: colors.series[i] }} />{x.label}</span>)}
              <span className="secondary">왼쪽 막대 = 물어본 것, 오른쪽 = 묻지 않고 한 것</span>
            </div>
          </ChartCard>
        );
      }}
    </Loaded>
  );
}
