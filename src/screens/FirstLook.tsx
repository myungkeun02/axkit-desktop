import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { errorText } from '../core/api';
import {
  activeLabel, countsLine, decodeFirstLook, decodeRevised, elapsedLine, errorLine, relationLabel, REVISE_MAX, STATUS_LINE,
  type FirstLook, type LookResult,
} from '../core/firstLook';
import { appliedLine, NOT_PROPOSED } from '../core/teamPlan';
import { Button, CardHeader, Empty, Meter, Panel, Spinner } from '../ui/kit';

/** §27 처음 알아보기: progress while files are read, then who the owner is and the companies → projects → teams it
 *  proposes; the owner fixes it by saying what is wrong, then builds it. */
export function FirstLookScreen() {
  const { session, go } = useApp();
  const [look, setLook] = useState<FirstLook | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    try { const l = decodeFirstLook(await session.api.view('first-look')); setLook(l); session.noteFirstLook(l?.status ?? null); setLoadProblem(null); setNow(Date.now()); }
    catch (e) { setLoadProblem(errorText(e)); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Once a second while reading (a light answer, §27.1), and again when something about the plan changes elsewhere.
  const running = look?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (session.planRev) void load(); }, [session.planRev]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!look) {
    return <div className="center-fill">{loadProblem ? <Empty title="불러오지 못했어요" message={loadProblem}><Button kind="secondary" onClick={() => void load()}>다시 해 보기</Button></Empty> : <Spinner />}</div>;
  }
  return (
    <div className="first-look">
      <Progress look={look} now={now} onChanged={load} />
      {look.result && <Result result={look.result} onResult={(r) => setLook({ ...look, result: r })} onBuilt={load} openPlan={() => go({ section: 'team-plan' })} />}
    </div>
  );
}

function Progress({ look, now, onChanged }: { look: FirstLook; now: number; onChanged: () => Promise<void> }) {
  const { session } = useApp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const counts = countsLine(look);
  const elapsed = elapsedLine(look, now);
  const canStart = look.status === 'idle' || look.status === 'paused' || look.status === 'failed';

  const start = async () => {
    setBusy(true); setProblem(null);
    try { await session.api.viewAction('first-look', 'start', {}); await onChanged(); }
    catch (e) { setProblem(errorText(e, '처음 알아보기가 꺼져 있어요. 설정에서 켜 주세요.')); }
    setBusy(false);
  };

  return (
    <Panel>
      <CardHeader title={STATUS_LINE[look.status]} subtitle={look.status === 'running' ? activeLabel(look) : look.status === 'failed' ? errorLine(look.error) : undefined}
        right={canStart ? <Button kind="primary" small busy={busy} onClick={() => void start()}>{look.status === 'idle' ? '알아보기 시작' : look.status === 'paused' ? '알아보기 계속' : '다시 시작'}</Button> : undefined} />
      {look.status !== 'idle' && (
        <div className="look-progress">
          <div className="look-bar"><Meter value={look.percent / 100} /><span className="look-percent">{look.percent}%</span></div>
          {counts && <div className="footnote">{counts}</div>}
          {elapsed && <div className="footnote">{elapsed}</div>}
          {look.status === 'running' && <div className="footnote">창을 닫아도 맥에서 계속 읽어요. 몇십 분에서 몇 시간 걸릴 수 있어요.</div>}
        </div>
      )}
      {problem && <div className="footnote" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{problem}</div>}
    </Panel>
  );
}

function Result({ result, onResult, onBuilt, openPlan }: { result: LookResult; onResult: (r: LookResult) => void; onBuilt: () => Promise<void>; openPlan: () => void }) {
  const { session } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'revise' | 'apply' | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const proposed = result.plan?.status === 'proposed';

  const revise = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy('revise'); setProblem(null);
    try {
      const r = decodeRevised(await session.api.viewAction('first-look', 'revise', { text: t.slice(0, REVISE_MAX) }));
      setReply(r.text || (r.changed.length ? `이렇게 바꿨어요: ${r.changed.join(', ')}` : '바꿀 것을 찾지 못했어요.'));
      if (r.result) onResult(r.result);
      if (r.changed.length) { setText(''); session.planRev++; void session.refreshTeamPlan(); }
    } catch (e) { setProblem(errorText(e, NOT_PROPOSED)); }
    setBusy(null);
  };

  const apply = async () => {
    setBusy('apply'); setProblem(null);
    try {
      const r = await session.api.viewAction<{ teams?: number; routines?: number }>('first-look', 'apply', {});
      session.say(appliedLine(r));
      await Promise.all([onBuilt(), session.refreshBots(), session.refreshTeamPlan()]);
    } catch (e) { setProblem(errorText(e, NOT_PROPOSED)); }
    setBusy(null);
  };

  return (
    <>
      {result.about && (
        <Panel>
          <CardHeader title="당신은 이런 사람이에요" />
          <div className="look-about selectable">{result.about}</div>
        </Panel>
      )}
      <Panel>
        <CardHeader title={result.companies.length ? '이런 조직이 필요해 보여요' : '회사나 프로젝트를 찾지 못했어요'}
          subtitle={result.plan?.status === 'applied' ? '이미 이대로 만들었어요.' : result.plan?.status === 'declined' ? '만들지 않기로 했어요.' : undefined}
          right={proposed ? <Button kind="secondary" small onClick={openPlan}>자세히 고치기</Button> : undefined} />
        <div className="look-tree">
          {result.companies.map((c) => (
            <div key={c.name} className="look-company">
              <div className="look-company-head"><span className="bold">{c.name}</span><span className="chip">{relationLabel(c.relation)}</span></div>
              {c.projects.map((p) => (
                <div key={p.name} className="look-project">
                  <div><span className="bold">{p.name}</span>{p.purpose && <span className="secondary"> · {p.purpose}</span>}</div>
                  {p.team && (
                    <div className="footnote">
                      {p.team.kind === 'dev' ? '개발팀 · 검수 포함' : '일반 팀'}
                      {p.team.roles.length > 0 && <> · {p.team.roles.map((r) => r.title).join(', ')}</>}
                    </div>
                  )}
                  {p.routines.map((r) => <div key={r.title} className="footnote">루틴: {r.title}{r.when ? ` · ${r.when}` : ''}</div>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Panel>
      {proposed && (
        <Panel>
          <CardHeader title="말로 고치기" subtitle="틀린 곳을 말해 주세요. 예: 에이컴퍼니랑 베타랩은 따로야. 감마랩은 베타랩 아래." />
          <div className="look-revise">
            <textarea className="field" rows={2} maxLength={REVISE_MAX} value={text} onChange={(e) => setText(e.target.value)} aria-label="고칠 내용"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void revise(); } }} />
            <Button kind="secondary" busy={busy === 'revise'} disabled={!text.trim() || !!busy} onClick={() => void revise()}>고치기</Button>
          </div>
          {reply && <div className="look-reply selectable">{reply}</div>}
          {problem && <div className="footnote" role="alert" style={{ color: 'var(--red)' }}>{problem}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button kind="primary" busy={busy === 'apply'} disabled={!!busy || result.companies.length === 0} onClick={() => void apply()}>이대로 만들기</Button>
          </div>
        </Panel>
      )}
    </>
  );
}
