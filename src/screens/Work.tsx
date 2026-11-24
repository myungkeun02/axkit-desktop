import { useEffect } from 'react';
import { useApp } from '../app/context';
import { clock, relative } from '../core/format';
import { elapsedLabel, kindLabel, openableLink, STATUS_LABEL, type WorkItem } from '../core/work';
import { openLink } from '../platform/tauri';
import { Button, CardHeader, Panel } from '../ui/kit';

const POLL_MS = 15_000;

/** §28 하고 있는 일: long tasks in the background (개발 작업, 브라우저 심부름, 생활 심부름) and what finished lately. */
export function WorkScreen() {
  const { session } = useApp();
  const work = session.work;
  const busy = (work?.active.length ?? 0) > 0;

  useEffect(() => { void session.refreshWork(); }, [session]);
  // While something runs, look again now and then (the phase moves: 코드 고치는 중 → 테스트 중 …).
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void session.refreshWork(), POLL_MS);
    return () => clearInterval(t);
  }, [session, busy]);

  if (!work) return <div className="center-fill"><span className="spinner" /></div>;
  return (
    <div className="work">
      <Panel>
        <CardHeader title="지금 하고 있는 일" subtitle="오래 걸리는 일은 비서가 뒤에서 하고, 끝나면 대화로 알려 줘요. '어떻게 됐어?'라고 물어도 돼요."
          right={<Button kind="secondary" small onClick={() => void session.refreshWork()}>새로 보기</Button>} />
        {work.active.length === 0
          ? <div className="secondary work-empty">지금 하고 있는 일이 없어요.</div>
          : <div className="work-list">{work.active.map((w) => <WorkRow key={w.id} w={w} />)}</div>}
      </Panel>
      <Panel>
        <CardHeader title="최근에 끝난 일" />
        {work.recent.length === 0
          ? <div className="secondary work-empty">아직 끝난 일이 없어요.</div>
          : <div className="work-list">{work.recent.map((w) => <WorkRow key={w.id} w={w} />)}</div>}
      </Panel>
    </div>
  );
}

function WorkRow({ w }: { w: WorkItem }) {
  const { session, openRoom, go } = useApp();
  const elapsed = elapsedLabel(w);
  const link = openableLink(w.link);
  const tone = w.status === 'failed' || w.status === 'interrupted' ? 'bad' : w.status === 'waiting' ? 'wait' : w.status === 'done' ? 'done' : 'run';
  return (
    <div className="work-row">
      <div className="work-top">
        <span className={`work-status ${tone}`}>{STATUS_LABEL[w.status]}</span>
        <span className="footnote">{kindLabel(w.kind)}</span>
        <span className="grow" />
        {w.updatedAt && <span className="footnote" title={clock(w.updatedAt)}>{relative(w.updatedAt)}</span>}
      </div>
      <div className="work-title">{w.title}</div>
      {(w.phase || elapsed) && <div className="secondary small">{[w.phase, elapsed].filter(Boolean).join(' · ')}</div>}
      {/* Read from a page, maybe: text only (§28.1). */}
      {w.summary && <div className="work-summary selectable">{w.summary}</div>}
      <div className="work-actions">
        {w.status === 'waiting' && w.kind !== 'dev' && <Button kind="primary" small onClick={() => go({ section: 'browser-live' })}>브라우저 화면 열기</Button>}
        {link && <Button kind="secondary" small onClick={() => void openLink(link)}>페이지 열기</Button>}
        {w.link && !link && <span className="footnote selectable">{w.link}</span>}
        {w.room !== undefined && <Button kind="secondary" small onClick={() => openRoom(w.room!)}>{w.room ? `${session.roomTitle(w.room)} 대화 보기` : '대화 보기'}</Button>}
        {w.status === 'interrupted' && w.kind === 'dev' && <Button kind="secondary" small onClick={() => { session.send(`'${w.title}' 이어서 해 줘`, w.room ?? ''); openRoom(w.room ?? ''); }}>이어서 해 달라고 하기</Button>}
      </div>
    </div>
  );
}

