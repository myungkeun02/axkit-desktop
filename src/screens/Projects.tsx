import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { errorText } from '../core/api';
import { relative } from '../core/format';
import {
  changed, companiesOf, decodeProjects, draftOf, mergeDraft, moveProject, nameProblem, pick, pickCompany, renameCompany, renameProject, saveBody,
  SAVE_MAX, scanCounts, scanTitle, sessionsLine, type Draft, type ProjectRow, type ProjectsView,
} from '../core/projects';
import { Button, Check, Empty, Icon, Panel, Sheet, Spinner } from '../ui/kit';
import { Banners } from './Banners';

type Editing = { kind: 'company'; name: string } | { kind: 'project'; path: string } | null;

/** §23 프로젝트 가져오기: which projects the first look reads, by company. Companies on the left, their projects on the
 * right; pick, rename and move, then save the whole picked list ('저장하고 바로 읽기' or '저장만'). */
export function Projects() {
  const { session } = useApp();
  const [view, setView] = useState<ProjectsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'rescan' | 'refresh' | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const viewRef = useRef<ProjectsView | null>(null);
  viewRef.current = view;

  const load = async () => {
    setLoadProblem(null);
    try {
      const v = decodeProjects(await session.api.view('projects'));
      setView(v); setDraft(draftOf(v));
    } catch (e) { setLoadProblem(errorText(e)); }
  };
  useEffect(() => { void load(); }, []);

  // While it reads, the status line at the top follows along (the list itself stays as the owner left it).
  const running = view?.scan.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const v = decodeProjects(await session.api.view('projects'));
        setView((old) => (old ? { ...old, scan: v.scan } : v));
      } catch { /* the next tick tries again */ }
    }, 15_000);
    return () => clearInterval(t);
  }, [running]);

  const refresh = async () => {
    if (!view || !draft) return;
    setBusy('refresh'); setProblem(null);
    try {
      const fresh = decodeProjects(await session.api.viewAction('projects', 'refresh', {}));
      setDraft((d) => (d ? mergeDraft(d, fresh, view) : draftOf(fresh)));
      setView(fresh);
      session.say('목록을 새로 찾았어요');
    } catch (e) { setProblem(errorText(e)); }
    setBusy(null);
  };

  const save = async (rescan: boolean) => {
    if (!draft) return;
    setBusy(rescan ? 'rescan' : 'save'); setProblem(null);
    try {
      const r = await session.api.viewAction<{ saved?: number; scan?: string }>('projects', 'save', saveBody(draft, rescan));
      const n = r?.saved ?? saveBody(draft, rescan).projects.length;
      session.say(`${n}개를 저장했어요. ${r?.scan === 'started' ? '지금 읽기 시작했어요.' : r?.scan === 'running' ? '이미 읽는 중이라 그다음에 반영돼요.' : '내일 새벽 정기 확인 때 읽어요.'}`);
      await load();
    } catch (e) { setProblem(errorText(e)); }
    setBusy(null);
  };

  const companies = draft ? companiesOf(draft) : [];
  const shown = companies.find((c) => c.name === company) ?? companies[0];
  const picked = draft?.rows.filter((r) => r.picked).length ?? 0;
  const dirty = !!(draft && view && changed(draft, view));
  const tooMany = picked > SAVE_MAX;

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>프로젝트 가져오기</h1>
        <div className="side right" style={{ gap: 8 }}>
          {draft && (
            <>
              <Button kind="secondary" small busy={busy === 'save'} disabled={!!busy || tooMany || !dirty} onClick={() => void save(false)}>저장만</Button>
              <Button kind="primary" small busy={busy === 'rescan'} disabled={!!busy || tooMany} onClick={() => void save(true)}>저장하고 바로 읽기</Button>
            </>
          )}
        </div>
      </header>
      <Banners />
      {!view || !draft ? (
        <div className="center-fill">
          {loadProblem ? <Empty title="불러오지 못했어요" message={loadProblem}><Button kind="secondary" onClick={() => void load()}>다시 해 보기</Button></Empty> : <Spinner />}
        </div>
      ) : (
        <div className="projects">
          <ScanLine view={view} picked={picked} dirty={dirty} busy={busy === 'refresh'} onRefresh={() => void refresh()} />
          {problem && <div className="footnote red projects-problem" role="alert">{problem}</div>}
          {tooMany && <div className="footnote red projects-problem">한 번에 {SAVE_MAX}개까지 고를 수 있어요. 지금 {picked}개예요.</div>}
          {companies.length === 0 ? (
            <div className="center-fill">
              <Empty icon={Icon.box} title="찾은 프로젝트가 없어요" message="setup에서 고른 폴더의 git 저장소와 이 맥의 Claude Code·Codex 대화 기록에서 찾아요. 새로 만든 저장소가 있으면 새로 찾아 보세요.">
                <Button kind="secondary" busy={busy === 'refresh'} onClick={() => void refresh()}>새로 찾기</Button>
              </Empty>
            </div>
          ) : (
            <div className="split">
              <div className="split-list" role="listbox" aria-label="회사">
                <div className="list-head">회사</div>
                <div className="scroll">
                  {companies.map((c) => (
                    <button key={c.name} role="option" aria-selected={shown?.name === c.name} className={`list-row${shown?.name === c.name ? ' on' : ''}`} onClick={() => setCompany(c.name)}>
                      <span className="grow ellipsis bold">{c.name}</span>
                      <span className="secondary">{c.picked}/{c.projects.length}</span>
                    </button>
                  ))}
                </div>
              </div>
              {shown && (
                <div className="split-detail scroll">
                  <div className="page">
                    <div className="projects-company">
                      <div className="grow">
                        <div className="bold" style={{ fontSize: '1.0625rem' }}>{shown.name}</div>
                        <div className="secondary">{shown.projects.length}개 중 {shown.picked}개 골랐어요</div>
                      </div>
                      <Button kind="secondary" small onClick={() => setDraft(pickCompany(draft, shown.name, shown.picked < shown.projects.filter((p) => p.lastActive).length))}>
                        {shown.picked < shown.projects.filter((p) => p.lastActive).length ? '모두 고르기' : '모두 빼기'}
                      </Button>
                      <Button kind="secondary" small onClick={() => setEditing({ kind: 'company', name: shown.name })}>회사 이름 바꾸기</Button>
                    </div>
                    <Panel tight>
                      {shown.projects.map((p) => (
                        <ProjectLine key={p.path} p={p} onPick={(on) => setDraft(pick(draft, p.path, on))} onEdit={() => setEditing({ kind: 'project', path: p.path })} />
                      ))}
                    </Panel>
                    <div className="footnote" style={{ padding: '0 4px' }}>
                      고른 프로젝트마다 지식 문서(문서 › 프로젝트/{shown.name})와 개발팀이 생겨요. 회사마다 "{shown.name} 업무" 팀도 생겨요. 이미 있는 이름은 그대로 둬요.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {editing?.kind === 'company' && draft && (
        <CompanySheet name={editing.name} others={companies.map((c) => c.name).filter((n) => n !== editing.name)} onClose={() => setEditing(null)}
          onSave={(to) => { setDraft(renameCompany(draft, editing.name, to)); setCompany(to.trim()); setEditing(null); }} />
      )}
      {editing?.kind === 'project' && draft && (() => {
        const p = draft.rows.find((r) => r.path === editing.path);
        return p ? (
          <ProjectSheet p={p} companies={companies.map((c) => c.name)} onClose={() => setEditing(null)}
            onSave={(name, to) => { setDraft(moveProject(renameProject(draft, p.path, name), p.path, to)); setEditing(null); }} />
        ) : null;
      })()}
    </>
  );
}

function ScanLine({ view, picked, dirty, busy, onRefresh }: { view: ProjectsView; picked: number; dirty: boolean; busy: boolean; onRefresh: () => void }) {
  const s = view.scan;
  const counts = scanCounts(s);
  const firstTime = !s.finishedAt && s.status !== 'done';
  return (
    <div className="projects-top">
      <Panel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {s.status === 'running' ? <Spinner /> : <span className="dot" style={{ background: s.status === 'failed' ? 'var(--red)' : s.status === 'done' ? 'var(--green)' : 'var(--text3)' }} />}
          <div className="grow">
            <div className="bold">{scanTitle(s)}{s.status === 'done' && s.finishedAt ? ` · ${relative(s.finishedAt)}` : ''}</div>
            <div className="secondary">{[counts || null, `${picked}개 골랐어요`, dirty ? '저장하지 않은 바뀐 것이 있어요' : null].filter(Boolean).join(' · ')}</div>
          </div>
          <Button kind="secondary" small busy={busy} onClick={onRefresh}>목록 새로 찾기</Button>
        </div>
        {(firstTime || s.status === 'running') && (
          <div className="note-box" style={{ marginTop: 10 }}>
            {firstTime ? '처음 한 번은 꼼꼼히 다 읽어서 몇십 분에서 몇 시간까지 걸릴 수 있어요. ' : ''}
            읽는 동안의 소식은 비서 대화에 알려 드려요. 모두 읽기만 하고 아무것도 바꾸지 않아요.
          </div>
        )}
      </Panel>
    </div>
  );
}

function ProjectLine({ p, onPick, onEdit }: { p: ProjectRow; onPick: (on: boolean) => void; onEdit: () => void }) {
  const missing = !p.lastActive;
  const detail = [missing ? '지금은 찾지 못한 폴더예요 · 빼기만 할 수 있어요' : `최근 작업 ${relative(p.lastActive!)}`, sessionsLine(p)].filter(Boolean).join(' · ');
  return (
    <div className="row project-row">
      <Check on={p.picked} onChange={(on) => { if (on && missing) return; onPick(on); }}>
        <span className="project-text">
          <span className={`bold${missing ? ' secondary' : ''}`}>{p.name}</span>
          <span className="footnote selectable ellipsis" title={p.path}>{p.display}{p.remote ? ` · ${p.remote}` : ''}</span>
          <span className="footnote">{detail}</span>
        </span>
      </Check>
      <Button kind="plain" small onClick={onEdit}>고치기</Button>
    </div>
  );
}

function CompanySheet({ name, others, onClose, onSave }: { name: string; others: string[]; onClose: () => void; onSave: (to: string) => void }) {
  const [to, setTo] = useState(name);
  const bad = nameProblem(to);
  const merges = others.includes(to.trim());
  return (
    <Sheet title="회사 이름 바꾸기" onClose={onClose}>
      <input className="field" value={to} autoFocus maxLength={100} onChange={(e) => setTo(e.target.value)} aria-label="회사 이름"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !bad) onSave(to); }} />
      {bad && to !== name ? <div className="footnote red">{bad}</div>
        : merges ? <div className="footnote">이미 있는 회사예요. 두 회사의 프로젝트가 하나로 합쳐져요.</div>
          : <div className="footnote">이 회사의 프로젝트가 모두 새 이름으로 옮겨가요. 저장해야 서버에 반영돼요.</div>}
      <Button kind="primary" full disabled={!!bad || to.trim() === name} onClick={() => onSave(to)}>바꾸기</Button>
    </Sheet>
  );
}

const NEW = '\u0000new';

function ProjectSheet({ p, companies, onClose, onSave }: { p: ProjectRow; companies: string[]; onClose: () => void; onSave: (name: string, company: string) => void }) {
  const [name, setName] = useState(p.name);
  const [choice, setChoice] = useState(p.company);
  const [fresh, setFresh] = useState('');
  const company = choice === NEW ? fresh : choice;
  const bad = nameProblem(name) ?? (choice === NEW ? nameProblem(fresh) : null);
  return (
    <Sheet title="프로젝트 고치기" onClose={onClose}>
      <div className="footnote selectable">{p.display}</div>
      <label className="form-label">이름
        <input className="field" value={name} autoFocus maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="form-label">회사
        <select className="field" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={NEW}>새 회사…</option>
        </select>
      </label>
      {choice === NEW && <input className="field" value={fresh} placeholder="새 회사 이름" maxLength={100} onChange={(e) => setFresh(e.target.value)} aria-label="새 회사 이름" />}
      {bad && (name.trim() !== p.name || choice === NEW) && <div className="footnote red">{bad}</div>}
      <Button kind="primary" full disabled={!!bad} onClick={() => onSave(name, company)}>고치기</Button>
      <div className="footnote">저장해야 서버에 반영돼요. 고르지 않은 프로젝트의 이름은 저장되지 않아요.</div>
    </Sheet>
  );
}
