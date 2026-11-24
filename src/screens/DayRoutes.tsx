import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { errorText, hasView } from '../core/api';
import { clock, won } from '../core/format';
import {
  formatDuration, leaveIn, leaveLine, modeLabel, pickRecommended, stops,
  type RouteLeg, type RouteOption, type RoutesView,
} from '../core/routes';
import { Button, CardHeader, Panel, Spinner, useLoad } from '../ui/kit';
import { MapView, type MapMarker, type MapRoute } from '../ui/MapView';

/** The day's moves: a map with every stop, then per leg when to leave and 대중교통 vs 자동차.
 * Renders nothing when the Mac has no `routes` view or the day has no places. */
export function DayRoutes({ date }: { date: string }) {
  const { session } = useApp();
  const available = hasView(session.capabilities, 'routes');
  const [state, reload] = useLoad(() => (available ? session.api.view<RoutesView>('routes', { date }) : Promise.resolve(null)), [date, available]);
  const [focus, setFocus] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, RouteOption['mode']>>({});
  const [now, setNow] = useState(Date.now());
  const [settingHome, setSettingHome] = useState(false);
  const canSetHome = (session.capabilities.views.find((v) => v.name === 'routes')?.actions ?? []).includes('setHome');

  useEffect(() => { setFocus(null); setChosen({}); }, [date]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const view = state.state === 'loaded' ? state.value : null;
  const optionOf = (leg: RouteLeg) => leg.options.find((o) => o.mode === chosen[leg.eventId]) ?? pickRecommended(leg.options);

  const markers = useMemo<MapMarker[]>(() => {
    if (!view?.legs.length) return [];
    return stops(view).map((p, i) => ({ id: `s${i}`, lat: p.lat, lng: p.lng, label: i === 0 ? p.name : String(i), title: p.name, kind: i === 0 ? 'home' : 'stop' }));
  }, [view]);

  const routes = useMemo<MapRoute[]>(() => (view?.legs ?? []).flatMap((leg) => {
    const o = leg.options.find((x) => x.mode === chosen[leg.eventId]) ?? pickRecommended(leg.options);
    return o?.path ? [{ id: `${leg.eventId}:${o.mode}`, mode: o.mode, path: o.path, highlighted: focus === leg.eventId }] : [];
  }), [view, chosen, focus]);

  if (!available) return null;
  if (state.state === 'loading') return <Panel><div className="footnote" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Spinner />길을 찾는 중…</div></Panel>;
  if (state.state === 'failed') return <Panel><div className="footnote">길찾기를 불러오지 못했어요. {state.message}</div></Panel>;
  if (!view) return null;
  // No home yet: say so and let the owner set it (the Mac finds the place with Kakao).
  if (view.origin === null) {
    return (
      <Panel>
        <CardHeader title="이동" subtitle={view.note ?? '집 위치를 정하면 일정 사이 길과 나갈 시간을 알려 드려요.'} />
        {canSetHome && <HomeSetter onDone={() => void reload()} />}
      </Panel>
    );
  }
  if (!view.legs.length) return null;

  return (
    <Panel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <CardHeader title="이동" subtitle={`${view.legs.length}곳 · 누르면 지도에서 그 길만 보여요`}
          right={<span style={{ display: 'flex', gap: 4 }}>
            {focus && <button className="btn plain small" onClick={() => setFocus(null)}>전체 보기</button>}
            {canSetHome && <button className="btn plain small" onClick={() => setSettingHome(!settingHome)}>집 바꾸기</button>}
          </span>} />
        {settingHome && <HomeSetter current={view.origin?.name} onDone={() => { setSettingHome(false); void reload(); }} />}
        {view.note && <div className="footnote">{view.note}</div>}
        <MapView markers={markers} routes={routes} height={300} focus={focus} />
        <div className="legs">
          {view.legs.map((leg) => (
            <Leg key={leg.eventId} leg={leg} on={focus === leg.eventId} option={optionOf(leg)} now={now}
              onFocus={() => setFocus(focus === leg.eventId ? null : leg.eventId)}
              onChoose={(mode) => { setChosen((c) => ({ ...c, [leg.eventId]: mode })); setFocus(leg.eventId); }} />
          ))}
        </div>
        <div className="footnote">길 정보: 카카오·ODsay(맥에서 찾음) · 지도: OpenFreeMap</div>
      </div>
    </Panel>
  );
}

function Leg({ leg, on, option, now, onFocus, onChoose }: {
  leg: RouteLeg; on: boolean; option?: RouteOption; now: number; onFocus: () => void; onChoose: (m: RouteOption['mode']) => void;
}) {
  const best = pickRecommended(leg.options);
  const late = option ? leaveIn(option, now).minutes < -1 : false;
  const past = Date.parse(leg.arriveBy) < now;
  return (
    <div className={`leg${on ? ' on' : ''}`} role="button" tabIndex={0} aria-pressed={on} onClick={onFocus}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(); } }}>
      <div className="where">
        <span className="secondary">{leg.from.name}</span>
        <span className="arrow">→</span>
        <span className="bold">{leg.title}</span>
        <span className="secondary">({leg.to.name})</span>
        <span className="footnote" style={{ marginLeft: 'auto' }}>{clock(leg.arriveBy)} 도착</span>
      </div>
      {option && (
        <div className="leave">
          <span className="big">{modeLabel(option.mode)} {formatDuration(option.durationMin)}</span>
          {!past && <span className={`when${late ? ' late' : ''}`}>{leaveLine(option, now)}</span>}
          {past && <span className="footnote">지난 일정이에요</span>}
        </div>
      )}
      {leg.note && <div className="footnote orange">{leg.note}</div>}
      <div className="modes">
        {leg.options.map((o) => (
          <button key={o.mode} className={`mode${o.mode === option?.mode ? ' on' : ''}`} aria-pressed={o.mode === option?.mode}
            onClick={(e) => { e.stopPropagation(); onChoose(o.mode); }}>
            <span className="name">{modeLabel(o.mode)}{o === best && <span className="pick">추천</span>}</span>
            <span className="dur">{formatDuration(o.durationMin)}</span>
            <span className="meta">{meta(o)}</span>
          </button>
        ))}
      </div>
      {option?.steps && option.steps.length > 0 && <Steps option={option} />}
    </div>
  );
}

function meta(o: RouteOption): string {
  return [
    o.distanceKm !== undefined ? `${o.distanceKm}km` : null,
    o.fareKrw ? won(o.fareKrw) : null,
    o.tollKrw ? `통행료 ${won(o.tollKrw)}` : null,
    o.summary && o.mode !== 'walk' ? o.summary : null,
  ].filter(Boolean).join(' · ');
}

const stepColor = (s: NonNullable<RouteOption['steps']>[number]) =>
  s.color ?? (s.mode === 'car' ? 'var(--orange)' : s.mode === 'bus' ? '#3366cc' : s.mode === 'subway' ? 'var(--accent)' : 'var(--text3)');

function Steps({ option }: { option: RouteOption }) {
  const steps = option.steps ?? [];
  const total = steps.reduce((n, s) => n + Math.max(s.durationMin, 1), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="steps-bar" aria-hidden>
        {steps.map((s, i) => (
          <span key={i} className={s.mode === 'walk' ? 'walk' : undefined}
            style={{ flex: Math.max(s.durationMin, 1) / total, background: s.mode === 'walk' ? undefined : stepColor(s) }} title={`${s.label} ${s.durationMin}분`} />
        ))}
      </div>
      <div className="steps-labels">
        {steps.map((s, i) => s.mode === 'walk'
          ? <span key={i}>걷기 {s.durationMin}분</span>
          : <span key={i} className="line"><span className="chip" style={{ background: stepColor(s) }} />{s.label} {s.durationMin}분</span>)}
      </div>
    </div>
  );
}

/** "집" for route planning: an address or place name; the Mac looks it up (Kakao) and keeps it. */
function HomeSetter({ current, onDone }: { current?: string; onDone: () => void }) {
  const { session } = useApp();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!query.trim() || saving) return;
    setSaving(true);
    try {
      const r = await session.api.viewAction<{ home?: { name?: string; address?: string } }>('routes', 'setHome', { query: query.trim() });
      session.say(`집을 ${r?.home?.name ?? r?.home?.address ?? query.trim()}(으)로 정했어요`);
      setQuery('');
      onDone();
    } catch (e) {
      session.say(errorText(e, '그 주소를 찾지 못했어요. 동 이름이나 도로명 주소로 적어 주세요.'));
    }
    setSaving(false);
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input className="field" placeholder={current ? `지금: ${current} · 새 주소나 장소 이름` : '집 주소나 가까운 장소 이름 (예: 망원동 OO아파트)'} value={query}
        onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }} aria-label="집 위치" />
      <Button kind="primary" small busy={saving} disabled={!query.trim()} onClick={() => void save()}>정하기</Button>
    </div>
  );
}
