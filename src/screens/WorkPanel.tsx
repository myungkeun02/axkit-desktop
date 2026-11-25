import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { hasView } from '../core/api';
import { relative } from '../core/format';
import { elapsedLabel, isRunning, panelRows, STATUS_LABEL, type PanelRow } from '../core/work';
import { Icon } from '../ui/kit';
import { CardPanel } from './Approvals';

const POLL_MS = 15_000;
const KEY = 'work-panel';
/** Under this window width the panel starts folded (the chat needs the room). */
const NARROW = 1100;

const TAB_KEY = 'side-tab';
type Tab = 'work' | 'approvals';

const readOpen = () => { try { return localStorage.getItem(KEY) !== 'closed'; } catch { return true; } };
const saveOpen = (open: boolean) => { try { localStorage.setItem(KEY, open ? 'open' : 'closed'); } catch { /* blocked */ } };
const readTab = (): Tab => { try { return localStorage.getItem(TAB_KEY) === 'approvals' ? 'approvals' : 'work'; } catch { return 'work'; } };
const saveTab = (tab: Tab) => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* blocked */ } };

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

/**
 * The panel to the right of a chat, in two tabs: 작업 (§31: what the assistant and the bots are doing in the
 * background, live) and 결재 (the open cards with their buttons, answered right here). Without a `work` view only 결재.
 */
export function WorkPanel() {
  const { session, go } = useApp();
  const [open, setOpen] = useState(readOpen);
  const [tabPicked, setTabPicked] = useState<Tab>(readTab);
  const narrow = useNarrow();
  // A narrow window folds it; opening it then lays it over the chat until it is folded again.
  const [overlay, setOverlay] = useState(false);
  useEffect(() => { if (!narrow) setOverlay(false); }, [narrow]);
  const hasWork = hasView(session.capabilities, 'work');
  const tab: Tab = hasWork ? tabPicked : 'approvals';
  const rows = panelRows(session.work);
  const busy = rows.runningCount > 0;
  const cards = session.timeline.openCards().filter((c) => !session.timeline.isDuplicate(c.cardId));

  useEffect(() => { if (hasWork && !session.work) void session.refreshWork(); }, [session, hasWork]); // eslint-disable-line react-hooks/exhaustive-deps
  // While something runs, look again every 15 s; otherwise a new notice in the chat triggers it (session.ts).
  useEffect(() => {
    if (!hasWork || !busy) return;
    const t = setInterval(() => void session.refreshWork(), POLL_MS);
    return () => clearInterval(t);
  }, [session, hasWork, busy]);

  const expanded = narrow ? overlay : open;
  const toggle = () => {
    if (narrow) { setOverlay(!overlay); return; }
    setOpen(!open);
    saveOpen(!open);
  };
  const show = (t: Tab) => { setTabPicked(t); saveTab(t); if (!expanded) toggle(); };
  const workBadge = busy ? `${rows.runningCount}개 하는 중` : null;

  if (!expanded) {
    return (
      <div className="work-rail">
        {hasWork && (
          <button className="work-rail-btn" onClick={() => show('work')} title="작업 펴기" aria-label={`작업 펴기${workBadge ? `, ${workBadge}` : ''}`} aria-expanded={false}>
            <Icon.checklist />
            {busy && <span className="badge">{rows.runningCount}</span>}
            <span className="work-rail-label">{workBadge ?? '작업'}</span>
          </button>
        )}
        <button className="work-rail-btn" onClick={() => show('approvals')} title="결재 펴기" aria-label={`결재 펴기${cards.length ? `, ${cards.length}건 기다림` : ''}`} aria-expanded={false}>
          <Icon.seal />
          {cards.length > 0 && <span className="badge">{cards.length}</span>}
          <span className="work-rail-label">결재</span>
        </button>
      </div>
    );
  }
  return (
    <aside className={`work-panel${narrow ? ' overlay' : ''}`} aria-label={tab === 'work' ? '작업 패널' : '결재 패널'}>
      <div className="work-panel-head">
        <div className="side-tabs" role="tablist">
          {hasWork && (
            <button role="tab" aria-selected={tab === 'work'} className={tab === 'work' ? 'on' : ''} onClick={() => show('work')}>
              작업{busy && <span className="badge soft">{rows.runningCount}</span>}
            </button>
          )}
          <button role="tab" aria-selected={tab === 'approvals'} className={tab === 'approvals' ? 'on' : ''} onClick={() => show('approvals')}>
            결재{cards.length > 0 && <span className="badge">{cards.length}</span>}
          </button>
        </div>
        <span className="grow" />
        <button className="btn plain small" onClick={() => go({ section: tab === 'work' ? 'work' : 'approvals' })} title={tab === 'work' ? '하고 있는 일 전체 보기' : '결재 화면에서 지난 결재까지 보기'}>전체</button>
        <button className="btn plain small" onClick={toggle} aria-expanded>접기</button>
      </div>
      {tab === 'work' ? (
        <div className="work-panel-body scroll" role="tabpanel">
          {rows.running.length === 0 && rows.finished.length === 0 && <div className="secondary work-panel-empty">지금 뒤에서 하는 일이 없어요. 오래 걸리는 일을 맡기면 여기에 보여요.</div>}
          {rows.running.length > 0 && <div className="work-panel-section">하는 중</div>}
          {rows.running.map((r) => <PanelItem key={r.item.id} row={r} />)}
          {rows.finished.length > 0 && <div className="work-panel-section">최근에 끝난 일</div>}
          {rows.finished.map((r) => <PanelItem key={r.item.id} row={r} />)}
        </div>
      ) : (
        <div className="work-panel-body scroll side-approvals" role="tabpanel">
          {cards.length === 0
            ? <div className="secondary work-panel-empty">기다리는 결재가 없어요. 비서가 물어볼 게 생기면 여기에 바로 보여요.</div>
            : cards.map((c) => <CardPanel key={c.cardId + ':' + c.seq} card={c} compact />)}
        </div>
      )}
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
