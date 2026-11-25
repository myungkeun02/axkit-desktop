import { lazy, useEffect, useState, Suspense } from 'react';
import { WorkPanel } from './WorkPanel';
import { useApp } from '../app/context';
import { hasView } from '../core/api';
import { clock, ymd } from '../core/format';
import type { TodayView } from '../core/views';
import { CardHeader, List, Loaded, Panel, Row, useLoad } from '../ui/kit';
import { CardPanel } from './Approvals';
import { eventCalendarLabel } from '../core/calendars';
import { Banners } from './Banners';
import { ChatRoom } from './Chat';

// The map (MapLibre) loads the first time a day with places is shown.
const DayRoutes = lazy(() => import('./DayRoutes').then((m) => ({ default: m.DayRoutes })));

/** 홈: the main chat, full width. Waiting 결재 show as one slim bar above the input (open it to answer in place);
 * 오늘 opens over the chat only when asked. */
export function Home() {
  const { session } = useApp();
  const [today, setToday] = useState(false);
  const hasToday = hasView(session.capabilities, 'today');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setToday(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>{session.assistantName}</h1>
        <div className="side right">
          {hasToday && <button className={`pill-btn${today ? ' on' : ''}`} onClick={() => setToday(!today)} aria-pressed={today}>오늘</button>}
        </div>
      </header>
      <Banners />
      <div className="split">
        <div className="split-main">
          <ChatRoom room="" tray={<ApprovalTray />} />
        </div>
        {!today && <WorkPanel />}
        {today && (
          <aside className="side-pane scroll overlay" aria-label="오늘">
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 0' }}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>오늘</div>
              <button className="btn plain small" onClick={() => setToday(false)}>닫기</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}><Today /></div>
          </aside>
        )}
      </div>
    </>
  );
}

/** One slim line while 결재 wait; opens to answer the newest one right here, then the next. */
function ApprovalTray() {
  const { session, go } = useApp();
  const open = session.timeline.openCards();
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  useEffect(() => { if (!open.length) setExpanded(false); if (index >= open.length) setIndex(0); }, [open.length, index]);
  if (!open.length) return null;
  const card = open[Math.min(index, open.length - 1)];
  if (!expanded) {
    return (
      <button className="tray" onClick={() => setExpanded(true)} title="여기서 바로 답하기">
        <span className="badge">{open.length}</span>
        <span className="bold" style={{ flex: 'none' }}>결재가 기다려요</span>
        <span className="secondary ellipsis" style={{ flex: 1 }}>{open[0].summary}</span>
        <span className="accent small bold" style={{ flex: 'none' }}>열기</span>
      </button>
    );
  }
  return (
    <div className="tray open" role="region" aria-label="결재">
      <div className="tray-head">
        <span className="bold">결재 {Math.min(index, open.length - 1) + 1} / {open.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn plain small" disabled={index === 0} onClick={() => setIndex(index - 1)}>이전</button>
        <button className="btn plain small" disabled={index >= open.length - 1} onClick={() => setIndex(index + 1)}>다음</button>
        <button className="btn plain small" onClick={() => go({ section: 'approvals' })}>모두 보기</button>
        <button className="btn plain small" onClick={() => setExpanded(false)}>접기</button>
      </div>
      <div className="tray-body"><CardPanel key={card.cardId + ':' + card.seq} card={card} compact /></div>
    </div>
  );
}

function Today() {
  const { session } = useApp();
  const [state, reload] = useLoad(() => session.api.view<TodayView>('today'), []);
  return (
    <Loaded value={state} retry={reload}>
      {(t) => (
        <>
          <Panel tight>
            <CardHeader title="일정" />
            <List>
              {t.events?.length ? t.events.map((e, i) => (
                <Row key={i} title={e.title} detail={e.calendar ? eventCalendarLabel(e) : undefined} trailing={<span className="secondary small">{e.allDay ? '종일' : clock(e.start)}</span>} />
              )) : <Row title={<span className="secondary">{t.events === null ? '캘린더가 아직 연결되지 않았어요' : '남은 일정이 없어요'}</span>} />}
            </List>
          </Panel>
          <Suspense fallback={null}><DayRoutes date={ymd(Date.now())} /></Suspense>
          <Panel tight>
            <CardHeader title="할 일" />
            <List>{t.todos?.length ? t.todos.map((d, i) => <Row key={i} title={d.text} />) : <Row title={<span className="secondary">오늘 할 일이 없어요</span>} />}</List>
          </Panel>
          {t.replies && t.replies.length > 0 && (
            <Panel tight>
              <CardHeader title="답을 기다리는 메시지" />
              <List>{t.replies.map((r, i) => <Row key={i} title={r.from} detail={r.text} />)}</List>
            </Panel>
          )}
        </>
      )}
    </Loaded>
  );
}

