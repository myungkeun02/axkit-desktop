import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { ApiError, errorText } from '../core/api';
import { relative } from '../core/format';
import {
  addRole, appliedLine, DAYS, decodePlan, editRole, editRoutine, editTeam, kindLabel, LIMITS, NOT_PROPOSED, planProblem, removeRole, removeRoutine, removeTeam,
  renameCompany, sameTeams, saveBody, scheduleLabel, tree, type Day, type PlanTeam, type Schedule, type TeamPlan,
} from '../core/teamPlan';
import { Button, CardHeader, Empty, Icon, List, Panel, Row, Sheet, Spinner } from '../ui/kit';
import { Banners } from './Banners';

/** §24 팀 구조 제안: the first look's company → team → roles (+ routines) proposal. Companies and teams on the left,
 * the chosen team on the right; while it is only proposed the owner edits it, then builds it ('이대로 만들기') or drops it. */
export function TeamPlanScreen() {
  const { session, go } = useApp();
  const [plan, setPlan] = useState<TeamPlan | null | undefined>(undefined);
  const [teams, setTeams] = useState<PlanTeam[]>([]);
  const [sel, setSel] = useState(0);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'apply' | 'decline' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);

  const load = async () => {
    setLoadProblem(null);
    try {
      const p = decodePlan(await session.api.view('team-plan'));
      setPlan(p); setTeams(p?.teams ?? []);
      setSel((i) => Math.min(i, Math.max((p?.teams.length ?? 1) - 1, 0)));
    } catch (e) { setLoadProblem(errorText(e)); }
  };
  useEffect(() => { void load(); }, []);

  const editable = plan?.status === 'proposed';
  const dirty = !!plan && editable && !sameTeams(plan.teams, teams);
  const check = planProblem(teams);

  /** A 400 without a sentence means the plan was built or dropped meanwhile: say so and look again. */
  const failed = async (e: unknown) => {
    setProblem(errorText(e, NOT_PROPOSED));
    if (e instanceof ApiError && e.kind === 'badRequest' && !e.serverMessage) { await load(); void session.refreshTeamPlan(); }
  };

  // Changed elsewhere (revised in the chat, built from its card): read it again unless the owner is mid-edit.
  useEffect(() => { if (session.planRev && !dirty) void load(); }, [session.planRev]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (): Promise<boolean> => {
    if (check) { setProblem(check); return false; }
    setBusy('save'); setProblem(null);
    try {
      // The whole list replaces the server's: if the plan changed there since it was loaded (a chat revision), saving
      // would undo that. Look first.
      const now = decodePlan(await session.api.view('team-plan'));
      if (!now || !plan || now.id !== plan.id || now.createdAt !== plan.createdAt || !sameTeams(now.teams, plan.teams)) {
        setProblem('그사이 대화에서 계획이 바뀌었어요. 새 계획을 불러왔어요. 고칠 것을 다시 고쳐 주세요.');
        await load();
        return false;
      }
      await session.api.viewAction('team-plan', 'save', saveBody(teams));
      setPlan((p) => (p ? { ...p, teams: saveBody(teams).teams } : p));
      return true;
    } catch (e) { await failed(e); return false; } finally { setBusy(null); }
  };

  const apply = async () => {
    if (dirty && !(await save())) return;
    setBusy('apply'); setProblem(null);
    try {
      const r = await session.api.viewAction<{ teams?: number; routines?: number }>('team-plan', 'apply', {});
      setResult(appliedLine(r));
      await Promise.all([load(), session.refreshBots(), session.refreshTeamPlan()]);
    } catch (e) { await failed(e); }
    setBusy(null);
  };

  const decline = async () => {
    setDeclining(false);
    setBusy('decline'); setProblem(null);
    try {
      await session.api.viewAction('team-plan', 'decline', {});
      session.say('팀 구조 제안을 만들지 않기로 했어요');
      await load();
      void session.refreshTeamPlan();
    } catch (e) { await failed(e); }
    setBusy(null);
  };

  const groups = tree(teams);
  const team = teams[sel];

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>팀 구조 제안</h1>
        <div className="side right" style={{ gap: 8 }}>
          {editable && (
            <>
              <Button kind="danger" small busy={busy === 'decline'} disabled={!!busy} onClick={() => setDeclining(true)}>만들지 않기</Button>
              {dirty && <Button kind="secondary" small busy={busy === 'save'} disabled={!!busy || !!check} onClick={() => void save().then((ok) => ok && session.say('고친 것을 저장했어요'))}>저장</Button>}
              <Button kind="primary" small busy={busy === 'apply'} disabled={!!busy || !!check || teams.length === 0} onClick={() => void apply()}>이대로 만들기</Button>
            </>
          )}
        </div>
      </header>
      <Banners />
      {plan === undefined ? (
        <div className="center-fill">{loadProblem ? <Empty title="불러오지 못했어요" message={loadProblem}><Button kind="secondary" onClick={() => void load()}>다시 해 보기</Button></Empty> : <Spinner />}</div>
      ) : plan === null ? (
        <div className="center-fill">
          <Empty icon={Icon.people} title="지금은 팀 구조 제안이 없어요" message="처음 알아보기가 회사와 프로젝트 구조를 찾으면 여기에 팀 제안이 생겨요.">
            <Button kind="secondary" onClick={() => go({ section: 'home' })}>비서에게 가기</Button>
          </Empty>
        </div>
      ) : (
        <div className="projects">
          <div className="projects-top">
            <Panel>
              <div className="bold">{plan.status === 'proposed' ? '일 지도대로 이렇게 팀을 만들까요?' : plan.status === 'applied' ? `만들었어요${plan.appliedAt ? ` · ${relative(plan.appliedAt)}` : ''}` : '만들지 않기로 했어요'}</div>
              <div className="secondary" style={{ marginTop: 4 }}>
                {plan.status === 'proposed'
                  ? `회사 ${groups.length}곳 · 팀 ${teams.length}개 · 직원 ${teams.reduce((n, t) => n + t.roles.length, 0)}명 · 루틴 ${teams.reduce((n, t) => n + t.routines.length, 0)}개. 고친 뒤 '이대로 만들기'를 누르면 그룹·팀·직원 봇이 생기고 루틴은 각 팀장에게 맡겨요. 이미 있는 이름은 그대로 둬요.`
                  : plan.status === 'applied' ? '이제 각 팀 방의 팀 설정과 루틴 화면에서 고쳐요.' : '처음 알아보기가 다시 제안하면 여기에 보여요.'}
              </div>
              {result && <div className="note-box" style={{ marginTop: 10 }} role="status">{result}</div>}
              {dirty && <div className="footnote" style={{ marginTop: 8 }}>저장하지 않은 고침이 있어요. '이대로 만들기'를 누르면 먼저 저장해요.</div>}
            </Panel>
          </div>
          {(problem || (dirty && check)) && <div className="footnote red projects-problem" role="alert">{problem ?? check}</div>}
          {teams.length === 0 ? (
            <div className="center-fill"><Empty icon={Icon.people} title="남은 팀이 없어요" message="모든 팀을 뺐어요. 만들지 않으려면 '만들지 않기'를 눌러 주세요." /></div>
          ) : (
            <div className="split">
              <div className="split-list" role="tree" aria-label="회사와 팀">
                <div className="scroll">
                  {groups.map((g) => (
                    <div key={g.company} role="group" aria-label={g.company}>
                      <div className="list-head">
                        <span className="grow ellipsis">{g.company}</span>
                        {editable && <button className="btn plain small" onClick={() => setRenaming(g.company)}>이름 바꾸기</button>}
                      </div>
                      {g.teams.map((i) => (
                        <button key={i} role="treeitem" aria-selected={i === sel} className={`list-row${i === sel ? ' on' : ''}`} onClick={() => setSel(i)}>
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="bold ellipsis" style={{ display: 'block' }}>{teams[i].name.trim() || '이름 없는 팀'}</span>
                            <span className="footnote ellipsis" style={{ display: 'block' }}>{[kindLabel(teams[i]), `직원 ${teams[i].roles.length}`, teams[i].routines.length ? `루틴 ${teams[i].routines.length}` : null].filter(Boolean).join(' · ')}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              {team && (
                <div className="split-detail scroll">
                  <div className="page">
                    <TeamDetail key={sel} team={team} editable={editable} companies={groups.map((g) => g.company)}
                      onChange={(f) => setTeams((all) => f(all, sel))}
                      onRemove={() => { setTeams((all) => removeTeam(all, sel)); setSel((i) => Math.max(0, i - 1)); }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {renaming !== null && (
        <RenameCompany name={renaming} others={groups.map((g) => g.company).filter((c) => c !== renaming)} onClose={() => setRenaming(null)}
          onSave={(to) => { setTeams((all) => renameCompany(all, renaming, to)); setRenaming(null); }} />
      )}
      {declining && (
        <Sheet title="만들지 않을까요?" onClose={() => setDeclining(false)}>
          <div>이 팀 구조 제안을 버려요. 팀과 봇은 만들지 않아요.</div>
          <Button kind="danger" full onClick={() => void decline()}>만들지 않기</Button>
        </Sheet>
      )}
    </>
  );
}

type Edit = (all: PlanTeam[], i: number) => PlanTeam[];

function TeamDetail({ team, editable, companies, onChange, onRemove }: { team: PlanTeam; editable: boolean; companies: string[]; onChange: (f: Edit) => void; onRemove: () => void }) {
  return (
    <>
      <Panel>
        <CardHeader title={editable ? '팀' : team.name} subtitle={kindLabel(team)}
          right={editable ? <Button kind="danger" small onClick={onRemove}>이 팀 빼기</Button> : undefined} />
        {editable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <label className="form-label">이름
              <input className="field" value={team.name} maxLength={LIMITS.name} onChange={(e) => onChange((a, i) => editTeam(a, i, { name: e.target.value }))} />
            </label>
            <label className="form-label">회사
              <input className="field" value={team.company} maxLength={LIMITS.company} list="plan-companies" onChange={(e) => onChange((a, i) => editTeam(a, i, { company: e.target.value }))} />
              <datalist id="plan-companies">{companies.map((c) => <option key={c} value={c} />)}</datalist>
              <span className="footnote" style={{ fontWeight: 400 }}>다른 회사와 같은 이름을 쓰면 그 회사로 옮겨요.</span>
            </label>
            <label className="form-label">목적
              <textarea className="field" rows={2} value={team.purpose} maxLength={LIMITS.purpose} onChange={(e) => onChange((a, i) => editTeam(a, i, { purpose: e.target.value }))} />
            </label>
          </div>
        ) : (
          <List>
            <Row title="회사" trailing={<span className="secondary">{team.company}</span>} />
            {team.purpose && <Row title="목적" detail={team.purpose} />}
          </List>
        )}
      </Panel>

      <Panel>
        <CardHeader title="직원 역할" subtitle={`${team.roles.length}명${team.kind === 'dev' ? ' · 검수 봇은 따로 붙어요' : ''}`}
          right={editable ? <Button kind="secondary" small disabled={team.roles.length >= LIMITS.roles} onClick={() => onChange((a, i) => addRole(a, i))}>역할 더하기</Button> : undefined} />
        {team.roles.length === 0 && <div className="secondary" style={{ padding: '8px 0' }}>{editable ? "아직 없어요. '역할 더하기'로 직원을 넣어요." : '없어요'}</div>}
        {editable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {team.roles.map((r, k) => (
              <div key={k} className="plan-role">
                <input className="field" value={r.title} placeholder="역할 (20자까지)" maxLength={LIMITS.roleTitle} aria-label="역할 이름" autoFocus={!r.title && k === team.roles.length - 1}
                  onChange={(e) => onChange((a, i) => editRole(a, i, k, { title: e.target.value }))} />
                <input className="field" value={r.does} placeholder="하는 일" maxLength={LIMITS.roleDoes} aria-label="하는 일"
                  onChange={(e) => onChange((a, i) => editRole(a, i, k, { does: e.target.value }))} />
                <Button kind="plain" small onClick={() => onChange((a, i) => removeRole(a, i, k))}>빼기</Button>
              </div>
            ))}
            {team.roles.length >= LIMITS.roles && <div className="footnote">한 팀에 {LIMITS.roles}명까지예요.</div>}
          </div>
        ) : (
          <List>{team.roles.map((r, k) => <Row key={k} title={r.title} detail={r.does || undefined} />)}</List>
        )}
      </Panel>

      <Panel>
        <CardHeader title="루틴" subtitle={editable ? '만들 때 이 팀 팀장에게 맡겨요' : undefined} />
        {team.routines.length === 0 && <div className="secondary" style={{ padding: '8px 0' }}>없어요</div>}
        {editable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
            {team.routines.map((r, k) => (
              <div key={k} className="plan-routine">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="field" value={r.title} maxLength={LIMITS.routineTitle} aria-label="루틴 제목" onChange={(e) => onChange((a, i) => editRoutine(a, i, k, { title: e.target.value }))} />
                  <Button kind="plain" small onClick={() => onChange((a, i) => removeRoutine(a, i, k))}>빼기</Button>
                </div>
                <textarea className="field" rows={2} value={r.instruction} maxLength={LIMITS.instruction} aria-label="하는 일" onChange={(e) => onChange((a, i) => editRoutine(a, i, k, { instruction: e.target.value }))} />
                <ScheduleEdit value={r.schedule} onChange={(schedule) => onChange((a, i) => editRoutine(a, i, k, { schedule }))} />
              </div>
            ))}
          </div>
        ) : (
          <List>{team.routines.map((r, k) => <Row key={k} title={r.title} detail={`${scheduleLabel(r.schedule)} · ${r.instruction}`} />)}</List>
        )}
      </Panel>

      {team.tasks.length > 0 && (
        <Panel>
          <CardHeader title="반복하는 일" subtitle="일 지도에서 찾은 것 (참고)" />
          <List>{team.tasks.map((t, k) => <Row key={k} title={t} />)}</List>
        </Panel>
      )}
    </>
  );
}

function ScheduleEdit({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const at = value.kind === 'every' ? '09:00' : value.at;
  const setKind = (kind: Schedule['kind']) => onChange(kind === 'daily' ? { kind, at } : kind === 'weekly' ? { kind, day: value.kind === 'weekly' ? value.day : 'mon', at } : { kind, hours: value.kind === 'every' ? value.hours : 6 });
  return (
    <div className="plan-schedule">
      <select className="field" value={value.kind} aria-label="얼마나 자주" onChange={(e) => setKind(e.target.value as Schedule['kind'])}>
        <option value="daily">매일</option>
        <option value="weekly">매주</option>
        <option value="every">몇 시간마다</option>
      </select>
      {value.kind === 'weekly' && (
        <select className="field" value={value.day} aria-label="요일" onChange={(e) => onChange({ ...value, day: e.target.value as Day })}>
          {DAYS.map((d) => <option key={d.id} value={d.id}>{d.label}요일</option>)}
        </select>
      )}
      {value.kind !== 'every' ? (
        <input className="field" type="time" value={value.at} aria-label="시각" onChange={(e) => e.target.value && onChange({ ...value, at: e.target.value })} />
      ) : (
        <select className="field" value={value.hours} aria-label="몇 시간마다" onChange={(e) => onChange({ kind: 'every', hours: Number(e.target.value) })}>
          {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => <option key={h} value={h}>{h === 24 ? '하루에 한 번' : `${h}시간마다`}</option>)}
        </select>
      )}
      <span className="footnote">{scheduleLabel(value)}</span>
    </div>
  );
}

function RenameCompany({ name, others, onClose, onSave }: { name: string; others: string[]; onClose: () => void; onSave: (to: string) => void }) {
  const [to, setTo] = useState(name);
  const t = to.trim();
  const bad = !t ? '이름을 써 주세요.' : t.length > LIMITS.company ? `이름은 ${LIMITS.company}자까지예요.` : null;
  return (
    <Sheet title="회사 이름 바꾸기" onClose={onClose}>
      <input className="field" value={to} autoFocus maxLength={100} aria-label="회사 이름" onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !bad && t !== name) onSave(to); }} />
      {bad && to !== name ? <div className="footnote red">{bad}</div>
        : others.includes(t) ? <div className="footnote">이미 있는 회사예요. 두 회사의 팀이 하나로 합쳐져요.</div>
          : <div className="footnote">이 회사의 팀이 모두 새 이름으로 옮겨가요.</div>}
      <Button kind="primary" full disabled={!!bad || t === name} onClick={() => onSave(to)}>바꾸기</Button>
    </Sheet>
  );
}
