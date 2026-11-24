import { lazy, useState, Suspense } from 'react';
import { useApp } from '../app/context';
import { viewActions } from '../core/api';
import { clock, fromZoneLocal, monthCells, monthTitle, shiftMonth, toZoneLocal, ymd } from '../core/format';
import type { CalendarDay, CalendarView } from '../core/views';
import { BotAvatar } from '../ui/BotAvatar';
import { Button, CardHeader, Icon, Loaded, Panel, Sheet, Switch, useLoad } from '../ui/kit';
import { Banners } from './Banners';

// The map (MapLibre) loads the first time a day with places is shown.
const DayRoutes = lazy(() => import('./DayRoutes').then((m) => ({ default: m.DayRoutes })));

/** 캘린더: plans (blue) and what the assistant and bots did (green) on one month. */
export function Calendar() {
  const { session } = useApp();
  const today = ymd(Date.now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const [state, reload] = useLoad(() => session.api.view<CalendarView>('calendar', { month }), [month]);
  const canAdd = viewActions(session.capabilities, 'calendar').includes('add');

  const shift = (n: number) => {
    const m = shiftMonth(month, n);
    setMonth(m);
    setSelected(m === today.slice(0, 7) ? today : `${m}-01`);
  };

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>캘린더</h1>
        <div className="side right">
          <button className="pill-btn" disabled={selected === today} onClick={() => { setSelected(today); setMonth(today.slice(0, 7)); }}>오늘로</button>
          {canAdd && <button className="icon-btn" title="일정 추가" aria-label="일정 추가" onClick={() => setAdding(true)}><Icon.plus /></button>}
        </div>
      </header>
      <Banners />
      <div className="scroll">
        <div className="page wide">
          <div className="cal-layout">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button kind="secondary" small onClick={() => shift(-1)} title="지난달"><span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.back /></span></Button>
                <div style={{ flex: 1, textAlign: 'center', fontSize: '1.25rem', fontWeight: 700 }}>{monthTitle(month)}</div>
                <Button kind="secondary" small onClick={() => shift(1)} title="다음 달"><span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.forward /></span></Button>
              </div>
              <Panel tight>
                <div className="cal-grid">
                  {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <div key={d} className="wd" style={i === 0 ? { color: 'var(--red)' } : undefined}>{d}</div>)}
                  {monthCells(month).map((day, i) => {
                    if (!day) return <div key={i} />;
                    const date = `${month}-${String(day).padStart(2, '0')}`;
                    const data = state.state === 'loaded' ? state.value.days.find((d) => d.date === date) : undefined;
                    return (
                      <button key={i} className={`cal-cell${date === today ? ' today' : ''}${date === selected ? ' sel' : ''}`} onClick={() => setSelected(date)} aria-pressed={date === selected}
                        aria-label={`${Number(date.slice(5, 7))}월 ${day}일${data?.events.length ? `, 일정 ${data.events.length}개` : ''}${data?.done.length ? `, 한 일 ${data.done.length}개` : ''}`}>
                        <span className="n">{day}</span>
                        <span className="dots">
                          {data?.events.length ? <span style={{ background: 'var(--accent)' }} /> : null}
                          {data?.done.length ? <span style={{ background: 'var(--green)' }} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>
              <div className="footnote" style={{ display: 'flex', gap: 16, paddingLeft: 4 }}>
                <span><span className="dot" style={{ background: 'var(--accent)', marginRight: 6 }} />일정</span>
                <span><span className="dot" style={{ background: 'var(--green)', marginRight: 6 }} />한 일</span>
              </div>
            </div>
            <Loaded value={state} retry={reload}>
              {(data) => <DayDetail date={selected} day={data.days.find((d) => d.date === selected)} />}
            </Loaded>
          </div>
          {state.state === 'loaded' && state.value.days.find((d) => d.date === selected)?.events.some((e) => e.geo) && <Suspense fallback={null}><DayRoutes key={selected} date={selected} /></Suspense>}
        </div>
      </div>
      {adding && <NewEvent day={selected} onClose={() => setAdding(false)} onAdded={(d) => { setSelected(d); setMonth(d.slice(0, 7)); void reload(); }} />}
    </>
  );
}

function DayDetail({ date, day }: { date: string; day?: CalendarDay }) {
  const { session } = useApp();
  const events = day?.events ?? [];
  const done = day?.done ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{Number(date.slice(5, 7))}월 {Number(date.slice(8, 10))}일</div>
      {!events.length && !done.length && <div className="secondary">이날은 일정도, 한 일도 없어요.</div>}
      {events.length > 0 && (
        <Panel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <CardHeader title="일정" />
            {events.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 12 }}>
                <span className="secondary" style={{ width: 76, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{e.allDay ? '종일' : clock(e.start)}</span>
                <div>
                  <div style={{ fontWeight: 500 }}>{e.title}</div>
                  {e.place && <div className="footnote">{e.place}{e.geo?.address ? ` · ${e.geo.address}` : ''}</div>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {done.length > 0 && (
        <Panel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <CardHeader title="한 일" />
            {done.map((d) => (
              <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <BotAvatar name={d.bot?.name ?? session.assistantName} size={28} />
                <div>
                  <div style={{ fontWeight: 500 }}>{d.title}</div>
                  <div className="footnote">{d.bot?.name ?? session.assistantName} · {clock(d.at)}</div>
                  {d.detail && <div className="footnote">{d.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/** Wall time in the assistant's zone for <input type=datetime-local>. */
const kstLocal = toZoneLocal;
const fromKstLocal = fromZoneLocal;

function NewEvent({ day, onClose, onAdded }: { day: string; onClose: () => void; onAdded: (day: string) => void }) {
  const { session } = useApp();
  const hour = Math.min(Number(toZoneLocal(Date.now()).slice(11, 13)) + 1, 23);
  const initial = fromZoneLocal(`${day}T${String(hour).padStart(2, '0')}:00`).getTime();
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(kstLocal(initial));
  const [end, setEnd] = useState(kstLocal(initial + 3600_000));
  const [startDay, setStartDay] = useState(day);
  const [saving, setSaving] = useState(false);
  const badRange = !allDay && fromKstLocal(end) < fromKstLocal(start);

  const save = async () => {
    setSaving(true);
    const body: Record<string, unknown> = { title: title.trim(), allDay, start: allDay ? startDay : fromKstLocal(start).toISOString() };
    if (!allDay) body.end = fromKstLocal(end).toISOString();
    if (place.trim()) body.place = place.trim();
    try {
      await session.api.viewAction('calendar', 'add', body);
      session.say('캘린더에 넣었어요');
      onAdded(allDay ? startDay : start.slice(0, 10));
      onClose();
    } catch (e) {
      session.say(e instanceof Error ? e.message : '넣지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title="일정 추가" onClose={onClose}>
      <Panel>
        <input className="field" style={{ fontSize: '1.0625rem', fontWeight: 600, border: 0, padding: '4px 0' }} autoFocus placeholder="무슨 일정인가요? (예: 치과)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div style={{ borderTop: '0.5px solid var(--sep)', margin: '10px 0' }} />
        <input className="field" style={{ border: 0, padding: '4px 0' }} placeholder="어디서 (안 적어도 돼요)" value={place} onChange={(e) => setPlace(e.target.value)} />
      </Panel>
      <Panel>
        <div className="row"><div className="grow">하루 종일</div><Switch on={allDay} onChange={setAllDay} label="하루 종일" /></div>
        <div className="row" style={{ borderTop: '0.5px solid var(--sep)' }}>
          <div className="grow">시작</div>
          {allDay ? <input type="date" className="field" style={{ width: 180 }} value={startDay} onChange={(e) => setStartDay(e.target.value)} />
            : <input type="datetime-local" className="field" style={{ width: 220 }} value={start} onChange={(e) => {
                setStart(e.target.value);
                if (fromKstLocal(end) <= fromKstLocal(e.target.value)) setEnd(kstLocal(fromKstLocal(e.target.value).getTime() + 3600_000));
              }} />}
        </div>
        {!allDay && (
          <div className="row" style={{ borderTop: '0.5px solid var(--sep)' }}>
            <div className="grow">끝</div>
            <input type="datetime-local" className="field" style={{ width: 220 }} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
        {badRange && <div className="footnote red">끝이 시작보다 빨라요.</div>}
      </Panel>
      <Button kind="primary" full busy={saving} disabled={!title.trim() || badRange} onClick={() => void save()}>캘린더에 넣기</Button>
    </Sheet>
  );
}
