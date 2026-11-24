import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { hasView } from '../core/api';
import { relative } from '../core/format';
import { elapsedLabel, isRunning, panelRows, STATUS_LABEL, type PanelRow } from '../core/work';
import { Icon } from '../ui/kit';

const POLL_MS = 15_000;
const KEY = 'work-panel';
/** Under this window width the panel starts folded (the chat needs the room). */
const NARROW = 1100;

const readOpen = () => { try { return localStorage.getItem(KEY) !== 'closed'; } catch { return true; } };
const saveOpen = (open: boolean) => { try { localStorage.setItem(KEY, open ? 'open' : 'closed'); } catch { /* blocked */ } };

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

/** §31 작업 패널, to the right of a chat: what the assistant and the bots are doing in the background, live. */
export function WorkPanel() {
  const { session, go } = useApp();
  const [open, setOpen] = useState(readOpen);
  const narrow = useNarrow();
  // A narrow window folds it; opening it then lays it over the chat until it is folded again.
  const [overlay, setOverlay] = useState(false);
  useEffect(() => { if (!narrow) setOverlay(false); }, [narrow]);
  const shown = hasView(session.capabilities, 'work');
  const rows = panelRows(session.work);
  const busy = rows.runningCount > 0;

  useEffect(() => { if (shown && !session.work) void session.refreshWork(); }, [session, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // While something runs, look again every 15 s; otherwise a new notice in the chat triggers it (session.ts).
  useEffect(() => {
    if (!shown || !busy) return;
    const t = setInterval(() => void session.refreshWork(), POLL_MS);
    return () => clearInterval(t);
  }, [session, shown, busy]);

  if (!shown) return null;
  const expanded = narrow ? overlay : open;
  const toggle = () => {
    if (narrow) { setOverlay(!overlay); return; }
    setOpen(!open);
    saveOpen(!open);
  };
  const badge = busy ? `${rows.runningCount}개 하는 중` : null;

  if (!expanded) {
    return (
      <button className="work-rail" onClick={toggle} title="작업 패널 펴기" aria-label={`작업 패널 펴기${badge ? `, ${badge}` : ''}`} aria-expanded={false}>
        <Icon.checklist />
        {busy && <span className="badge">{rows.runningCount}</span>}
        <span className="work-rail-label">{badge ?? '작업'}</span>
      </button>
    );
  }
  return (
    <aside className={`work-panel${narrow ? ' overlay' : ''}`} aria-label="작업 패널">
      <div className="work-panel-head">
        <span className="bold">작업</span>
        {badge && <span className="chip">{badge}</span>}
        <span className="grow" />
        <button className="btn plain small" onClick={() => go({ section: 'work' })} title="하고 있는 일 전체 보기">전체</button>
        <button className="btn plain small" onClick={toggle} aria-expanded>접기</button>
      </div>
      <div className="work-panel-body scroll">
        {rows.running.length === 0 && rows.finished.length === 0 && <div className="secondary work-panel-empty">지금 뒤에서 하는 일이 없어요. 오래 걸리는 일을 맡기면 여기에 보여요.</div>}
        {rows.running.length > 0 && <div className="work-panel-section">하는 중</div>}
        {rows.running.map((r) => <PanelItem key={r.item.id} row={r} />)}
        {rows.finished.length > 0 && <div className="work-panel-section">최근에 끝난 일</div>}
        {rows.finished.map((r) => <PanelItem key={r.item.id} row={r} />)}
      </div>
    </aside>
  );
}

function PanelItem({ row: { item: w, depth } }: { row: PanelRow }) {
  const { session, openRoom } = useApp();
  const running = isRunning(w);
  const tone = w.status === 'failed' || w.status === 'interrupted' ? 'bad' : w.status === 'waiting' ? 'wait' : w.status === 'done' ? 'done' : 'run';
  const elapsed = elapsedLabel(w);
  const where = w.room === undefined ? null : w.room ? session.roomTitle(w.room) : session.assistantName;
  const body = (
    <>
      <div className="wp-top">
        <span className={`wp-dot ${tone}`} aria-hidden />
        <span className="wp-title">{w.title}</span>
      </div>
      <div className="wp-meta footnote">
        {[STATUS_LABEL[w.status], w.phase, elapsed, !running && w.updatedAt ? relative(w.updatedAt) : null].filter(Boolean).join(' · ')}
      </div>
      {where && <div className="wp-where footnote">{where} 대화</div>}
    </>
  );
  const style = { paddingLeft: 12 + depth * 16 };
  return w.room !== undefined
    ? <button className={`wp-item${depth ? ' sub' : ''}`} style={style} onClick={() => openRoom(w.room!)} title={`${where} 대화 열기`}>{body}</button>
    : <div className={`wp-item${depth ? ' sub' : ''}`} style={style}>{body}</div>;
}
