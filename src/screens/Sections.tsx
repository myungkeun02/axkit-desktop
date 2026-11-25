import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { PairForm } from './Connect';
import { recorder, useRecorder } from '../app/recorder';
import { errorText, hasFeature, hasView, viewActions } from '../core/api';
import { clock, dollars, duration, relative, shiftMonth, upcoming, won, ymd } from '../core/format';
import { connectionLabel } from '../core/session';
import {
  canToggle, type AutonomyView, type BlocksView, rowMessage, rowQuery, type HardwareView, type Job, type JobsView, type ModelTiersView,
  type Provider, type ProvidersView, type Routine, type RoutinesView, type Recording, type RecordingsView, type SpendEntry, type SpendingView, type UsageView,
} from '../core/views';
import { Button, CardHeader, Check, Icon, KV, List, Loaded, Markdown, MenuRow, Meter, Panel, Row, Segmented, Sheet, Spinner, Switch, useLoad } from '../ui/kit';
import { Banners } from './Banners';
import { UpdateSettings } from './AppUpdate';
import { forgetSiteMessage } from '../core/browserLive';
import { fixRequest, healthOf, problems, type HealthStatus } from '../core/health';
import { notificationsOn, notify, setNotificationsOn } from '../platform/tauri';
import { setTextStep, useTextStep } from '../app/textSize';
import { percentLabel, TEXT_STEPS } from '../core/textSize';


/** A sidebar section: title bar, banners, then the screen on the grey page. */
export function SectionPage({ title, wide, right, children }: { title: string; wide?: boolean; right?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>{title}</h1>
        <div className="side right">{right}</div>
      </header>
      <Banners />
      <div className="scroll"><div className={`page${wide ? ' wide' : ''}`}>{children}</div></div>
    </>
  );
}

export const dotColor = (c: string) => (c === 'live' ? 'var(--green)' : c === 'connecting' ? 'var(--orange)' : 'var(--red)');

// ---------- 설정 및 연결 ----------
function TextSizeSettings() {
  const step = useTextStep();
  return (
    <Panel>
      <CardHeader title="글자 크기" subtitle={`이 맥에서만 바뀌어요. ⌘+ ⌘- 로 키우고 줄이고, ⌘0 은 기본. 지금 ${percentLabel(step)}`} />
      <div className="segmented text-size" role="radiogroup" aria-label="글자 크기">
        {TEXT_STEPS.map((s, i) => (
          <button key={s.label} role="radio" aria-checked={i === step} className={i === step ? 'on' : ''} onClick={() => setTextStep(i)}
            style={{ fontSize: `${0.8125 * (0.85 + i * 0.08)}rem` }}>{s.label}</button>
        ))}
      </div>
      <div className="text-size-sample">비서에게 이렇게 보여요. 내일 오전 10시에 김민수 대표님과 회의가 있어요.</div>
    </Panel>
  );
}

/** 더 보기: screens taken off the sidebar because they are opened rarely (they stay in ⌘K too). */
function MoreScreens() {
  const { session, go } = useApp();
  const caps = session.capabilities;
  const rows: { key: Parameters<typeof go>[0]['section']; icon: () => ReactNode; title: string; detail: string; show: boolean }[] = [
    { key: 'first-look', icon: Icon.sparkle, title: session.firstLook === 'done' ? '처음 알아보기 다시 하기' : '처음 알아보기', detail: '맥의 파일을 읽고 회사·프로젝트·팀을 다시 제안받아요', show: hasFeature(caps, 'first-look') && hasView(caps, 'first-look') },
    { key: 'projects', icon: Icon.box, title: '프로젝트 가져오기', detail: '처음 알아보기가 읽을 프로젝트를 회사별로 골라요', show: hasFeature(caps, 'projects') && hasView(caps, 'projects') },
    { key: 'health', icon: Icon.check2, title: '상태 점검', detail: '비서 맥에 문제가 있는지, 고쳐 달라고 하기', show: hasView(caps, 'health') },
    { key: 'hardware', icon: Icon.cpu, title: '맥 상태', detail: 'CPU·메모리·디스크·전원', show: hasView(caps, 'hardware') },
    { key: 'modeltiers', icon: Icon.tiers, title: '등급과 용도', detail: '어떤 일에 어떤 AI 등급을 쓰는지', show: hasView(caps, 'modeltiers') },
    { key: 'browser-live', icon: Icon.globe, title: '브라우저 화면 넘겨받기', detail: '비서가 로그인 같은 걸 부탁할 때 여는 화면', show: hasFeature(caps, 'browser-live') && hasView(caps, 'browser-live') },
    { key: 'phone-apps', icon: Icon.phone, title: '휴대폰 앱 설치', detail: '아이폰·안드로이드 앱 설치 QR', show: true },
    { key: 'help', icon: Icon.info, title: '도움말', detail: '처음 쓰는 법', show: true },
  ];
  return (
    <Panel tight>
      <CardHeader title="더 보기" subtitle="자주 쓰지 않아 사이드바에서 뺀 화면이에요. ⌘K로도 찾아 가요." />
      {rows.filter((r) => r.show).map((r) => <MenuRow key={r.key} icon={r.icon} title={r.title} detail={r.detail} onClick={() => go({ section: r.key })} />)}
    </Panel>
  );
}

export function Settings() {
  const { session } = useApp();
  const [busy, setBusy] = useState(false);
  const [mockUrl, setMockUrl] = useState('http://127.0.0.1:47795');
  const info = session.info;
  return (
    <>
      <Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span style={{ width: 30, height: 30, color: 'var(--accent)', display: 'inline-flex' }}><Icon.mac /></span>
            <div>
              <div className="bold" style={{ fontSize: '0.9375rem' }}>{info?.mode === 'mock' ? '개발용 가짜 맥' : info?.mode === 'remote' ? '다른 맥의 비서' : '이 맥의 ax-kit'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="secondary">
                <span className="dot" style={{ background: dotColor(session.connection) }} />{connectionLabel[session.connection]}
                {info?.host && <span>· {info.host}</span>}
              </div>
            </div>
          </div>
          {info?.problem && <div className="footnote" style={{ color: session.connection === 'none' ? 'var(--text2)' : 'var(--red)' }}>{info.problem}</div>}
          <Button kind="secondary" full busy={busy} onClick={async () => { setBusy(true); await session.reconnect(); setBusy(false); }}>지금 다시 연결해 보기</Button>
        </div>
      </Panel>
      <OtherMac />
      <MoreScreens />
      <UpdateSettings />
      <TextSizeSettings />
      <NotifySettings />
      <KV title="연결 방법" items={[
        { k: '방식', v: info?.mode === 'mock' ? '가짜 맥 (개발용)' : info?.mode === 'remote' ? '다른 맥과 짝 맞춤 (Tailscale)' : '이 맥 전용 연결 (짝 맞추기 없음)' },
        ...(info?.mode === 'remote' && info.deviceName ? [{ k: '이 기기 이름', v: info.deviceName }] : []),
        ...(info?.mode === 'local' && info?.tokenFile ? [{ k: '연결 파일', v: <span className="selectable small">{info.tokenFile}</span> }] : []),
        { k: '비서 이름', v: session.assistantName },
        { k: '서버', v: session.capabilities.server ?? 'ax-kit' },
        { k: '앱 버전', v: __APP_VERSION__ },
      ]} />
      <Panel>
        <div className="footnote">
          {info?.mode === 'remote'
            ? '연결 토큰은 이 맥의 키체인에만 있고 앱의 화면 쪽으로 넘어오지 않아요. 80일마다 새 토큰으로 바꿔요.'
            : '연결 토큰은 앱의 화면 쪽으로 넘어오지 않아요. ax-kit가 켜질 때마다 새 토큰을 연결 파일에 쓰고, 앱은 그 파일을 다시 읽어 붙어요. 이 연결은 이 맥 안(127.0.0.1)에서만 쓸 수 있어요.'}
        </div>
      </Panel>
      {info?.devBuild && (
        <Panel>
          <CardHeader title="개발용" subtitle="개발 빌드에서만 보여요. iOS 레포의 가짜 맥(npm run mock)에 붙어요." />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <input className="field" value={mockUrl} onChange={(e) => setMockUrl(e.target.value)} aria-label="가짜 맥 주소" />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button kind="secondary" onClick={() => void session.switchTo({ mock: mockUrl })}>가짜 맥에 연결</Button>
              {info.mode === 'mock' && <Button kind="secondary" onClick={() => void session.switchTo('local')}>이 맥의 ax-kit로 돌아가기</Button>}
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

/** 다른 맥의 비서: pair here, or (when paired) drop it and use this Mac's ax-kit. */
function OtherMac() {
  const { session, go } = useApp();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const info = session.info;
  if (info?.mode === 'mock') return null;
  if (info?.mode === 'remote') {
    return (
      <Panel>
        <CardHeader title="다른 맥의 비서" subtitle={`${info.host ?? ''}${info.deviceName ? ` · 이 기기: ${info.deviceName}` : ''}`} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {confirm ? (
            <>
              <Button kind="danger" onClick={() => { setConfirm(false); void session.forgetRemote(); }}>연결 끊기</Button>
              <Button kind="secondary" onClick={() => setConfirm(false)}>그대로 두기</Button>
            </>
          ) : <Button kind="secondary" onClick={() => setConfirm(true)}>연결 끊고 이 맥의 비서 쓰기</Button>}
          <Button kind="secondary" onClick={() => setOpen(!open)}>{open ? '닫기' : '다시 짝 맞추기'}</Button>
        </div>
        {confirm && <div className="footnote" style={{ marginTop: 8 }}>그 맥에서도 이 기기의 연결이 바로 지워져요. 다시 쓰려면 짝 맞추기를 새로 해요.</div>}
        {open && <div style={{ marginTop: 12 }}><PairForm onDone={() => setOpen(false)} /></div>}
      </Panel>
    );
  }
  return (
    <Panel>
      <CardHeader title="다른 맥의 비서에 연결" subtitle="비서가 집의 맥미니 같은 다른 맥에서 돌면, Tailscale로 그 맥에 붙어요." />
      {open ? <div style={{ marginTop: 12 }}><PairForm onDone={() => setOpen(false)} /></div> : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button kind="secondary" onClick={() => setOpen(true)}>짝 맞추기</Button>
          <Button kind="secondary" onClick={() => go({ section: 'help' })}>도움말</Button>
        </div>
      )}
    </Panel>
  );
}

function NotifySettings() {
  const { session } = useApp();
  const [on, setOn] = useState(notificationsOn());
  return (
    <Panel>
      <CardHeader title="알림" />
      <List>
        <Row title="맥 알림 받기" detail="창이 앞에 없을 때 결재, 비서의 말, 팀이 끝냈거나 막힌 일을 알려요. 1분에 3개까지, 나머지는 한 줄로 모아요."
          trailing={<Switch on={on} label="맥 알림 받기" onChange={(v) => { setOn(v); setNotificationsOn(v); }} />} />
        <Row title="시험 알림 보내기" trailing={<Button kind="secondary" small onClick={() => { void notify('ax-kit', '알림이 이렇게 와요.'); session.say('시험 알림을 보냈어요'); }}>보내기</Button>} />
      </List>
      <div className="footnote" style={{ paddingTop: 6 }}>창을 닫아도 ax-kit는 메뉴 막대에 남아 알림을 받아요. 끝내려면 ⌘Q.</div>
    </Panel>
  );
}

// ---------- 알아서 하는 일 (R11) ----------
export function AutonomyScreen({ embedded }: { embedded?: boolean }) {
  const { session } = useApp();
  const [state, reload] = useLoad(() => session.api.view<AutonomyView>('autonomy'), []);
  const [stopping, setStopping] = useState<{ id: string; label: string } | null>(null);
  return (
    <Loaded value={state} retry={reload}>
      {(data) => (
        <>
          <div className="secondary" style={{ padding: embedded ? 0 : '0 4px' }}>결재에서 '앞으로는 알아서'를 고르면 여기에 생겨요. 한 일은 캘린더의 '한 일'에 남아요.</div>
          <Panel>
            <CardHeader title="묻지 않고 하는 일" />
            {data.rules.length === 0 && <div className="secondary" style={{ padding: '8px 0' }}>아직 없어요</div>}
            <List>
              {data.rules.map((r) => (
                <Row key={r.id} title={r.label}
                  detail={[r.detail, r.since ? `${relative(r.since)}부터` : null, r.uses !== undefined ? `${r.uses}번 했어요` : null].filter(Boolean).join(' · ')}
                  trailing={<Button kind="danger" small onClick={() => setStopping(r)}>그만</Button>} />
              ))}
            </List>
          </Panel>
          {data.alwaysAsk && data.alwaysAsk.length > 0 && (
            <Panel>
              <CardHeader title="이건 언제나 물어봐요" />
              <List>{data.alwaysAsk.map((a) => <Row key={a} title={a} />)}</List>
            </Panel>
          )}
          {stopping && (
            <Sheet title="그만할까요?" onClose={() => setStopping(null)}>
              <div>'{stopping.label}'를 그만하면 다음부터 다시 물어봐요.</div>
              <Button kind="danger" full onClick={async () => {
                try { await session.api.viewAction('autonomy', 'revoke', { id: stopping.id }); session.say('다음부터 다시 물어볼게요'); }
                catch (e) { session.say(errorText(e)); }
                setStopping(null);
                void reload();
              }}>그만하고 다시 물어보기</Button>
              <Button kind="secondary" full onClick={() => setStopping(null)}>그대로 두기</Button>
            </Sheet>
          )}
        </>
      )}
    </Loaded>
  );
}

// ---------- 상태 점검 (view `health`) ----------
export function HealthScreen() {
  const { session, go } = useApp();
  const [state, reload] = useLoad(() => session.api.view<unknown>('health').then(healthOf), []);
  const color = (s: HealthStatus) => (s === 'ok' ? 'var(--green)' : s === 'warn' ? 'var(--orange)' : 'var(--red)');
  const word = (s: HealthStatus) => (s === 'ok' ? '괜찮아요' : s === 'warn' ? '봐 주세요' : '문제예요');
  return (
    <Loaded value={state} retry={reload}>
      {(h) => {
        const bad = problems(h);
        const counts = { ok: h.checks.length - bad.length, warn: bad.filter((c) => c.status === 'warn').length, error: bad.filter((c) => c.status === 'error').length };
        return (
          <>
            <Panel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{h.summary ?? (bad.length ? `${bad.length}가지를 봐 주세요` : '모두 괜찮아요')}</div>
                <div style={{ display: 'flex', gap: 16 }} className="secondary">
                  <span><span className="dot" style={{ background: 'var(--green)', marginRight: 6 }} />괜찮음 {counts.ok}</span>
                  <span><span className="dot" style={{ background: 'var(--orange)', marginRight: 6 }} />봐 주세요 {counts.warn}</span>
                  <span><span className="dot" style={{ background: 'var(--red)', marginRight: 6 }} />문제 {counts.error}</span>
                </div>
                {h.checkedAt && <div className="footnote">{relative(h.checkedAt)} 점검</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  {bad.length > 0 && <Button kind="primary" onClick={() => { session.send(fixRequest(h), ''); session.say('비서에게 고쳐 달라고 했어요'); go({ section: 'home' }); }}>비서에게 고쳐 달라고 하기</Button>}
                  <Button kind="secondary" onClick={() => void reload()}>다시 점검</Button>
                </div>
              </div>
            </Panel>
            {[bad, h.checks.filter((c) => c.status === 'ok')].map((list, i) => list.length > 0 && (
              <Panel key={i}>
                <details open={i === 0}>
                  <summary className="bold" style={{ cursor: 'pointer', padding: '2px 0 8px' }}>{i === 0 ? `봐야 할 것 ${list.length}개` : `괜찮은 것 ${list.length}개`}</summary>
                  <List>
                    {list.map((c) => (
                      <Row key={c.id} title={<span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="dot" style={{ background: color(c.status), width: 10, height: 10 }} aria-hidden />{c.label}</span>}
                        detail={[c.detail, c.fix && c.status !== 'ok' ? `고치는 법: ${c.fix}` : null].filter(Boolean).join(' · ')}
                        trailing={<span className="small bold" style={{ color: color(c.status) }}>{word(c.status)}</span>} />
                    ))}
                  </List>
                </details>
              </Panel>
            ))}
          </>
        );
      }}
    </Loaded>
  );
}

// ---------- 루틴 (§17) ----------
export function Routines() {
  const { session, go } = useApp();
  const [state, reload] = useLoad(() => session.api.view<RoutinesView>('routines'), []);
  const actions = viewActions(session.capabilities, 'routines');
  const [removing, setRemoving] = useState<Routine | null>(null);
  const toggle = async (r: Routine, enabled: boolean) => {
    try { await session.api.viewAction('routines', 'toggle', { id: r.id, enabled }); session.say(enabled ? `'${r.title}'을(를) 다시 켰어요` : `'${r.title}'을(를) 껐어요`); }
    catch (e) { session.say(errorText(e)); }
    void reload();
  };
  return (
    <Loaded value={state} retry={reload}>
      {(data) => (
        <>
          <Panel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="secondary">정해진 때에 비서나 팀이 알아서 하는 일이에요. 새 루틴은 비서에게 말로 부탁하세요. 예: "매일 아침 9시에 오늘 일정 정리해 줘"</div>
              <Button kind="primary" full onClick={() => go({ section: 'home' })}>비서에게 말하러 가기</Button>
            </div>
          </Panel>
          <Panel>
            <CardHeader title="루틴" subtitle={data.limit ? `${data.routines.length} / ${data.limit}개` : undefined} />
            {!data.routines.length && <div className="secondary" style={{ padding: '8px 0' }}>아직 없어요</div>}
            <List>
              {data.routines.map((r) => (
                <div key={r.id} className="routine">
                  <Row title={<span style={{ opacity: r.enabled ? 1 : 0.55 }}>{r.title}</span>}
                    detail={<>
                      <span>{[r.scheduleLabel, r.bot?.name ?? session.assistantName].join(' · ')}</span>
                      {r.lastRun && <span className={r.lastOk === false ? 'red' : undefined} style={{ display: 'block' }}>
                        {relative(r.lastRun)} {r.lastOk === false ? '실패' : '함'}{r.lastResult ? ` · ${r.lastResult}` : ''}
                      </span>}
                      {!r.enabled && r.lastOk === false && <span style={{ display: 'block' }}>세 번 연속 안 돼서 멈췄어요. 다시 켜면 처음부터 셉니다.</span>}
                    </>}
                    trailing={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {actions.includes('toggle') && <Switch on={r.enabled} onChange={(v) => void toggle(r, v)} label={`${r.title} 켜기`} />}
                      {actions.includes('remove') && <Button kind="danger" small onClick={() => setRemoving(r)}>지우기</Button>}
                    </span>} />
                  <div className="footnote routine-instruction selectable">{r.instruction}</div>
                </div>
              ))}
            </List>
          </Panel>
          {data.followUps.length > 0 && (
            <Panel>
              <CardHeader title="봇이 나중에 볼 것" subtitle="때가 되면 그 봇이 다시 확인하고 알려 드려요." />
              <List>{data.followUps.map((f, i) => <Row key={i} title={f.what} detail={`${f.bot.name} · ${upcoming(f.dueAt)}`} />)}</List>
            </Panel>
          )}
          {removing && (
            <Sheet title="이 루틴을 지울까요?" onClose={() => setRemoving(null)}>
              <div>'{removing.title}'은(는) 다시 돌지 않아요. 필요하면 비서에게 다시 부탁하면 돼요.</div>
              <Button kind="danger" full onClick={async () => {
                try { await session.api.viewAction('routines', 'remove', { id: removing.id }); session.say('루틴을 지웠어요'); } catch (e) { session.say(errorText(e)); }
                setRemoving(null); void reload();
              }}>지우기</Button>
              <Button kind="secondary" full onClick={() => setRemoving(null)}>그대로 두기</Button>
            </Sheet>
          )}
        </>
      )}
    </Loaded>
  );
}

// ---------- 반복 작업 ----------
export function Jobs() {
  const { session, go } = useApp();
  const [state, reload] = useLoad(() => session.api.view<JobsView>('jobs'), []);
  const canSwitch = viewActions(session.capabilities, 'jobs').includes('toggle');
  return (
    <Loaded value={state} retry={reload}>
      {(data) => (
        <>
          <Panel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="secondary">새 반복 작업은 비서에게 말로 부탁하세요. 예: "매일 아침 8시에 날씨 알려 줘"</div>
              <Button kind="primary" full onClick={() => go({ section: 'home' })}>비서에게 말하러 가기</Button>
            </div>
          </Panel>
          {data.groups.map((g) => (
            <Panel key={g.id}>
              <CardHeader title={g.label} />
              <List>{g.jobs.map((j) => <JobRow key={j.id} job={j} canSwitch={canSwitch && canToggle(j)} onChanged={reload} />)}</List>
            </Panel>
          ))}
        </>
      )}
    </Loaded>
  );
}

function JobRow({ job, canSwitch, onChanged }: { job: Job; canSwitch: boolean; onChanged: () => void }) {
  const { session } = useApp();
  const [on, setOn] = useState(job.enabled);
  useEffect(() => setOn(job.enabled), [job.enabled]);
  const parts = [job.scheduleLabel ?? ''];
  let bad = false;
  if (job.running) parts.push('도는 중');
  if (job.lastRun?.startedAt) {
    if (job.lastRun.ok === false) { parts.push(`${relative(job.lastRun.startedAt)} 문제: ${job.lastRun.error ?? ''}`); bad = true; }
    else parts.push(`${relative(job.lastRun.startedAt)} 잘 끝남`);
  }
  const set = async (v: boolean) => {
    setOn(v);
    try {
      await session.api.viewAction('jobs', 'toggle', { id: job.id, enabled: v });
      session.say(v ? `'${job.name}'을(를) 켰어요` : `'${job.name}'을(를) 껐어요`);
    } catch (e) { session.say(errorText(e)); setOn(!v); }
    onChanged();
  };
  return (
    <Row title={job.name} detail={<span className={bad ? 'red' : undefined}>{parts.filter(Boolean).join(' · ')}</span>}
      trailing={canSwitch ? <Switch on={on} onChange={(v) => void set(v)} label={job.name} /> : <span className="footnote">{job.enabled ? '켜짐' : '꺼짐'}</span>} />
  );
}

// ---------- 지출 관리 ----------
export function Spending() {
  const { session } = useApp();
  const [month, setMonth] = useState(ymd(Date.now()).slice(0, 7));
  const [state, reload] = useLoad(() => session.api.view<SpendingView>('spending', { month }), [month]);
  const actions = viewActions(session.capabilities, 'spending');
  const [editing, setEditing] = useState<SpendEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [budget, setBudget] = useState<string | null>(null);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button kind="secondary" small onClick={() => setMonth(shiftMonth(month, -1))}><span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.back /></span></Button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{Number(month.slice(5))}월</div>
        <Button kind="secondary" small disabled={month >= ymd(Date.now()).slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.forward /></span></Button>
        {actions.includes('add') && <Button kind="secondary" small onClick={() => setAdding(true)}>현금 지출 적기</Button>}
      </div>
      <Loaded value={state} retry={reload}>
        {(s) => {
          const top = s.byCategory[0]?.amount ?? 1;
          return (
            <>
              <Panel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="secondary">{Number(s.month.slice(5))}월에 쓴 돈</div>
                  <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: -0.5 }}>{won(s.total)}</div>
                  {s.budget ? (
                    <>
                      <Meter value={s.total / s.budget} color={s.total > s.budget ? 'var(--red)' : s.total > s.budget * 0.8 ? 'var(--orange)' : 'var(--green)'} />
                      <div className="footnote">{s.total > s.budget ? `예산보다 ${won(s.total - s.budget)} 더 썼어요` : `예산 ${won(s.budget)} 중 ${won(s.budget - s.total)} 남았어요`}</div>
                    </>
                  ) : null}
                  {s.previousTotal ? <div className="footnote">{s.total >= s.previousTotal ? `지난달보다 ${won(s.total - s.previousTotal)} 더 썼어요` : `지난달보다 ${won(s.previousTotal - s.total)} 덜 썼어요`}</div> : null}
                  {actions.includes('budget') && <div><Button kind="secondary" small onClick={() => setBudget(s.budget ? String(s.budget) : '')}>{s.budget ? '예산 바꾸기' : '예산 정하기'}</Button></div>}
                </div>
              </Panel>
              {s.byCategory.length > 0 && (
                <Panel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <CardHeader title="어디에 썼나" />
                    {s.byCategory.map((c) => (
                      <div key={c.category} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>{c.label}</span><span className="secondary">{won(c.amount)}</span></div>
                        <Meter value={c.amount / Math.max(top, 1)} />
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
              {s.subscriptions && s.subscriptions.length > 0 && (
                <KV title="매달 나가는 돈" items={s.subscriptions.map((sub) => ({ k: sub.merchant, v: won(sub.amount) + (sub.nextDate ? ` · ${sub.nextDate.slice(5).replace('-', '/')}` : '') }))} />
              )}
              <Panel>
                <CardHeader title="내역" subtitle={actions.includes('categorize') ? '누르면 분류를 바꿀 수 있어요' : undefined} />
                <List>
                  {(s.entries ?? []).map((e) => (
                    <Row key={e.id} title={e.merchant} detail={`${e.date.slice(5).replace('-', '/')} · ${e.categoryLabel ?? '분류 없음'}${e.note ? ` · ${e.note}` : ''}`}
                      trailing={<span style={{ fontVariantNumeric: 'tabular-nums', color: e.amount < 0 ? 'var(--green)' : undefined }}>{won(e.amount)}</span>}
                      onClick={actions.includes('categorize') ? () => setEditing(e) : undefined} />
                  ))}
                </List>
                {!s.entries?.length && <div className="secondary">이달 내역이 없어요</div>}
              </Panel>
              {editing && <CategorySheet entry={editing} categories={s.categories ?? []} onClose={() => setEditing(null)} onDone={reload} />}
              {adding && <AddEntrySheet categories={s.categories ?? []} onClose={() => setAdding(false)} onDone={reload} />}
              {budget !== null && (
                <Sheet title="한 달 예산" onClose={() => setBudget(null)}>
                  <input className="field" inputMode="numeric" autoFocus placeholder="예: 1200000" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} />
                  <Button kind="primary" full disabled={!budget} onClick={async () => {
                    try { await session.api.viewAction('spending', 'budget', { monthly: Number(budget) }); } catch (e) { session.say(errorText(e)); }
                    setBudget(null); void reload();
                  }}>저장</Button>
                  {s.budget ? <Button kind="danger" full onClick={async () => {
                    try { await session.api.viewAction('spending', 'budget', { monthly: null }); } catch (e) { session.say(errorText(e)); }
                    setBudget(null); void reload();
                  }}>예산 없애기</Button> : null}
                </Sheet>
              )}
            </>
          );
        }}
      </Loaded>
    </>
  );
}

function CategorySheet({ entry, categories, onClose, onDone }: { entry: SpendEntry; categories: { id: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const { session } = useApp();
  const [remember, setRemember] = useState(true);
  return (
    <Sheet title="분류 바꾸기" onClose={onClose}>
      <Panel tight><Row title={entry.merchant} trailing={<span>{won(entry.amount)}</span>} /></Panel>
      <Check on={remember} onChange={setRemember}>다음부터 '{entry.merchant}'은(는) 늘 이 분류로</Check>
      <Panel tight>
        <List>
          {categories.map((c) => (
            <Row key={c.id} title={c.label} trailing={c.id === entry.category ? <span className="accent" style={{ width: 16, height: 16, display: 'inline-flex' }}><Icon.check /></span> : null}
              onClick={async () => {
                try { await session.api.viewAction('spending', 'categorize', { entryId: entry.id, category: c.id, remember }); session.say(`'${c.label}'(으)로 바꿨어요`); }
                catch (e) { session.say(errorText(e)); }
                onDone(); onClose();
              }} />
          ))}
        </List>
      </Panel>
    </Sheet>
  );
}

function AddEntrySheet({ categories, onClose, onDone }: { categories: { id: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const { session } = useApp();
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(ymd(Date.now()));
  const [category, setCategory] = useState(categories.find((c) => c.id === 'other')?.id ?? categories[0]?.id ?? 'other');
  return (
    <Sheet title="현금 지출 적기" onClose={onClose}>
      <input className="field" autoFocus placeholder="어디서 (예: 시장)" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
      <input className="field" inputMode="numeric" placeholder="얼마 (원)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
      <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      <Button kind="primary" full disabled={!merchant.trim() || !(Number(amount) > 0)} onClick={async () => {
        try { await session.api.viewAction('spending', 'add', { merchant: merchant.trim(), amount: Number(amount), date, category }); session.say('적었어요'); }
        catch (e) { session.say(errorText(e)); }
        onDone(); onClose();
      }}>적기</Button>
    </Sheet>
  );
}

// ---------- 봇·AI 사용량 ----------
const modelName = (id: string) => id.split('-').filter(Boolean).reduce<string[]>((out, p, i, all) => {
  const known: Record<string, string> = { gpt: 'GPT', deepseek: 'DeepSeek', mini: 'mini', nano: 'nano', pro: 'Pro' };
  if (/^\d+$/.test(p) && /^\d+$/.test(all[i - 1] ?? '')) out[out.length - 1] += `.${p}`;
  else out.push(known[p.toLowerCase()] ?? (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)));
  return out;
}, []).join(' ');
const providerName = (id?: string) => (id ? ({ anthropic: 'Claude', openai: 'ChatGPT', deepseek: 'DeepSeek', google: 'Gemini', gemini: 'Gemini', ollama: '맥 안의 AI' } as Record<string, string>)[id] ?? id : undefined);

export function Usage() {
  const { session } = useApp();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [state, reload] = useLoad(() => session.api.view<UsageView>('usage', { period }), [period]);
  return (
    <>
      <div><Segmented value={period} onChange={setPeriod} options={[{ id: 'day', label: '오늘' }, { id: 'week', label: '최근 7일' }, { id: 'month', label: '이번 달' }]} /></div>
      <Loaded value={state} retry={reload}>
        {(u) => {
          const failRate = u.totals.calls + u.totals.failures === 0 ? 0 : u.totals.failures / (u.totals.calls + u.totals.failures);
          const limit = u.budget ? (u.period === 'month' ? u.budget.monthlyUsd : u.budget.dailyUsd) : 0;
          const maxCalls = Math.max(1, ...(u.daily ?? []).map((d) => d.calls));
          const maxBot = Math.max(1, ...(u.byBot ?? []).map((b) => b.calls));
          return (
            <>
              <Panel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>AI에게 {u.totals.calls.toLocaleString('ko-KR')}번 물어봤어요</div>
                  <div>쓴 돈: {dollars(u.totals.costUsd)} (약 {won(u.totals.costUsd * 1400)})</div>
                  <div className="footnote">{failRate < 0.05 ? '거의 다 잘 됐어요' : `실패가 조금 많아요 (${u.totals.failures}번). AI 연결하기를 확인해 보세요.`}</div>
                  {limit > 0 && (
                    <>
                      <Meter value={u.totals.costUsd / limit} color={u.totals.costUsd > limit * 0.8 ? 'var(--orange)' : undefined} />
                      <div className="footnote">예산 {dollars(limit)} 중 {Math.round((u.totals.costUsd / limit) * 100)}%</div>
                    </>
                  )}
                </div>
              </Panel>
              {u.daily && u.daily.length > 0 && (
                <Panel>
                  <CardHeader title={u.period === 'day' ? '시간별' : '날짜별'} />
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140, marginTop: 12 }} role="img" aria-label="호출 수 막대 그래프">
                    {u.daily.map((d) => (
                      <div key={d.date} title={`${u.period === 'day' ? d.date.slice(11, 16) : d.date.slice(5)} · ${d.calls}번`}
                        style={{ flex: 1, height: `${Math.max(2, (d.calls / maxCalls) * 100)}%`, background: 'var(--accent)', borderRadius: '3px 3px 0 0', opacity: d.calls ? 1 : 0.25 }} />
                    ))}
                  </div>
                  <div className="footnote" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span>{u.period === 'day' ? u.daily[0].date.slice(11, 16) : u.daily[0].date.slice(5)}</span>
                    <span>{u.period === 'day' ? u.daily.at(-1)!.date.slice(11, 16) : u.daily.at(-1)!.date.slice(5)}</span>
                  </div>
                </Panel>
              )}
              {u.byBot && u.byBot.length > 0 && (
                <Panel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <CardHeader title="봇별" />
                    {u.byBot.map((b) => (
                      <div key={b.botId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>{b.name}</span><span className="secondary">{b.calls}번 · {dollars(b.costUsd)}</span></div>
                        <Meter value={b.calls / maxBot} />
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
              <Panel>
                <CardHeader title="AI 모델별" />
                <List>{u.byModel.map((m) => <Row key={m.providerId + m.model} title={modelName(m.model)} detail={providerName(m.providerId)} trailing={<span className="secondary">{m.calls}번 · {dollars(m.costUsd)}</span>} />)}</List>
              </Panel>
            </>
          );
        }}
      </Loaded>
    </>
  );
}

// ---------- AI 연결하기 (R7) ----------
export function Providers() {
  const { session } = useApp();
  const [state, reload] = useLoad(() => session.api.view<ProvidersView>('providers'), []);
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
  return (
    <Loaded value={state} retry={reload}>
      {(data) => (
        <>
          <div className="secondary" style={{ padding: '0 4px' }}>비서가 쓸 AI를 연결해요. 여러 개를 연결하면 일에 맞게 골라 쓰고, 하나가 막히면 다른 걸 써요.</div>
          <Panel>
            <List>
              {data.providers.map((p) => (
                <Row key={p.id} title={p.label}
                  detail={[p.detail ?? (p.connected ? '연결됨' : '연결 안 됨'), p.keyHint, p.kind === 'subscription' ? '로그인은 맥에서 해요' : null].filter(Boolean).join(' · ')}
                  trailing={p.kind === 'api_key'
                    ? p.connected ? <Button kind="danger" small onClick={() => setDisconnecting(p)}>끊기</Button> : <Button kind="primary" small onClick={() => setConnecting(p)}>연결</Button>
                    : <span className="dot" style={{ background: p.connected ? 'var(--green)' : 'var(--text3)' }} />} />
              ))}
            </List>
          </Panel>
          {connecting && <KeySheet provider={connecting} onClose={() => setConnecting(null)} onDone={reload} />}
          {disconnecting && (
            <Sheet title={`${disconnecting.label} 연결을 끊을까요?`} onClose={() => setDisconnecting(null)}>
              <div>맥에 저장된 키가 지워져요. 비서는 다른 AI를 써요.</div>
              <Button kind="danger" full onClick={async () => {
                try { await session.api.disconnectProvider(disconnecting.id); session.say(`${disconnecting.label} 연결을 끊었어요`); } catch (e) { session.say(errorText(e)); }
                setDisconnecting(null); void reload();
              }}>연결 끊기</Button>
              <Button kind="secondary" full onClick={() => setDisconnecting(null)}>그대로 두기</Button>
            </Sheet>
          )}
        </>
      )}
    </Loaded>
  );
}

function KeySheet({ provider, onClose, onDone }: { provider: Provider; onClose: () => void; onDone: () => void }) {
  const { session } = useApp();
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Sheet title={`${provider.label} 연결`} onClose={onClose}>
      <div>{provider.label} 사이트에서 만든 API 키를 붙여 넣어 주세요.</div>
      {provider.help && <div className="footnote">{provider.help}</div>}
      <input className="field" type="password" autoFocus autoComplete="off" spellCheck={false} placeholder="API 키" value={key} onChange={(e) => setKey(e.target.value)} />
      <div className="footnote">키는 이 앱에 남지 않고, 맥의 키체인에만 저장돼요. 다시 보여 주지도 않아요.</div>
      <Button kind="primary" full busy={saving} disabled={key.trim().length < 8} onClick={async () => {
        setSaving(true);
        try { await session.api.connectProvider(provider.id, key.trim()); setKey(''); session.say(`${provider.label}을(를) 연결했어요`); onDone(); onClose(); }
        catch (e) { session.say(errorText(e)); }
        setSaving(false);
      }}>맥에 저장</Button>
    </Sheet>
  );
}

// ---------- AI 등급과 용도 (R12) ----------
export function ModelTiers() {
  const { session } = useApp();
  const [state, reload] = useLoad(() => session.api.view<ModelTiersView>('modeltiers'), []);
  const [reordering, setReordering] = useState(false);
  const act = async (action: string, body: Record<string, unknown>) => {
    try { await session.api.viewAction('modeltiers', action, body); } catch (e) { session.say(errorText(e)); }
    void reload();
  };
  return (
    <Loaded value={state} retry={reload}>
      {(data) => (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div className="secondary" style={{ flex: 1, padding: '0 4px' }}>일마다 어느 등급의 AI를 쓸지 정해요. 같은 등급 안에서는 위에 있는 모델부터 쓰고, 막히면 다음 모델로 넘어가요.</div>
            <Button kind="secondary" small onClick={() => setReordering(!reordering)}>{reordering ? '완료' : '순서 바꾸기'}</Button>
          </div>
          <Panel>
            <CardHeader title="용도별 등급" />
            <List>
              {data.purposes.map((p) => (
                <Row key={p.id} title={p.label} detail={[p.detail, p.calls7d !== undefined ? `최근 7일 ${p.calls7d}번` : null].filter(Boolean).join(' · ')}
                  trailing={
                    <select className="btn secondary small" style={{ appearance: 'none', paddingRight: 12 }} value={p.tier} aria-label={`${p.label} 등급`}
                      onChange={(e) => void act('purpose', { id: p.id, tier: e.target.value })}>
                      {data.tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  } />
              ))}
            </List>
          </Panel>
          {data.tiers.map((t) => (
            <Panel key={t.id}>
              <CardHeader title={t.label} subtitle={t.summary} />
              <List>
                {t.models.map((m, i) => (
                  <Row key={m.id} title={`${i + 1}. ${m.label}`} titleClass={m.available === false ? 'secondary' : undefined}
                    detail={[m.provider, m.note, m.available === false ? '연결 안 됨' : null].filter(Boolean).join(' · ')}
                    trailing={reordering ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <Button kind="secondary" small disabled={i === 0} title="위로" onClick={() => { const ids = t.models.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; void act('rank', { tier: t.id, order: ids }); }}>위로</Button>
                        <Button kind="secondary" small disabled={i === t.models.length - 1} title="아래로" onClick={() => { const ids = t.models.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; void act('rank', { tier: t.id, order: ids }); }}>아래로</Button>
                      </span>
                    ) : undefined} />
                ))}
              </List>
            </Panel>
          ))}
        </>
      )}
    </Loaded>
  );
}

// ---------- 맥 상태 (R8) ----------
export function Hardware() {
  const { session } = useApp();
  const [state, reload] = useLoad(() => session.api.view<HardwareView>('hardware'), [], true);
  useEffect(() => { const t = setInterval(() => void reload(), 15_000); return () => clearInterval(t); }, [reload]);
  const thermal = (s?: string): [string, string] => s === 'nominal' ? ['시원해요', 'green'] : s === 'fair' ? ['조금 따뜻해요', 'orange'] : s === 'serious' ? ['뜨거워요 — 일이 느려질 수 있어요', 'orange'] : s === 'critical' ? ['너무 뜨거워요', 'red'] : ['알 수 없어요', 'secondary'];
  const label = (k: string) => ({ tailscale: 'Tailscale', internet: '인터넷', version: '버전', uptime: '켜진 지', stop: '전체 정지 스위치' } as Record<string, string>)[k] ?? k;
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return (
    <Loaded value={state} retry={reload}>
      {(h) => {
        const t = thermal(h.thermal);
        return (
          <>
            <Panel>
              <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>{h.machine.name}</div>
              {h.summary && <div className="secondary">{h.summary}</div>}
            </Panel>
            <Panel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <CardHeader title="지금" />
                {h.cpuPercent !== undefined && <MeterLine title="일하는 정도(CPU)" value={h.cpuPercent / 100} detail={`${Math.round(h.cpuPercent)}%`} />}
                {h.memory && <MeterLine title="기억 공간(메모리)" value={h.memory.used / h.memory.total} detail={`${n(h.memory.used)} / ${n(h.memory.total)} ${h.memory.unit}`} />}
                {h.disk && <MeterLine title="저장 공간" value={h.disk.used / h.disk.total} detail={`${n(h.disk.total - h.disk.used)} ${h.disk.unit} 남음`} />}
              </div>
            </Panel>
            <KV title="맥" items={[
              { k: '온도', v: t[0], cls: t[1] },
              ...(h.power ? [{ k: '전원', v: h.power }] : []),
              ...(h.machine.model ? [{ k: '기종', v: h.machine.model }] : []),
              ...(h.machine.os ? [{ k: '운영체제', v: h.machine.os }] : []),
              ...(h.machine.uptimeSec ? [{ k: '켜진 지', v: duration(h.machine.uptimeSec) }] : []),
            ]} />
            {h.network && <KV title="네트워크" items={Object.entries(h.network).sort().map(([k, v]) => ({ k: label(k), v }))} />}
            {h.server && <KV title="비서 프로그램" items={Object.entries(h.server).sort().map(([k, v]) => ({ k: label(k), v }))} />}
            {h.checkedAt && <div className="footnote" style={{ padding: '0 4px' }}>{relative(h.checkedAt)} 확인 · 15초마다 새로 봐요</div>}
          </>
        );
      }}
    </Loaded>
  );
}

function MeterLine({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>{title}</span><span className="secondary">{detail}</span></div>
      <Meter value={value} color={value > 0.85 ? 'var(--orange)' : undefined} />
    </div>
  );
}

// ---------- 녹음 → 회의록 (R14) ----------
export function Recordings() {
  const { session, go } = useApp();
  const rec = useRecorder();
  const [confirm, setConfirm] = useState(false);
  const [state, reload] = useLoad(() => session.api.view<RecordingsView>('recordings'), [], true);
  useEffect(() => { const t = setInterval(() => void reload(), 4000); return () => clearInterval(t); }, [reload]);
  const words = (r: Recording) => r.status === 'receiving' ? '받는 중' : r.status === 'transcribing' ? '글로 받아 적는 중' : r.status === 'summarizing' ? '회의록으로 정리하는 중'
    : r.status === 'failed' ? '정리하지 못했어요' : r.driveUrl ? '정리 끝 · Drive에 저장됨' : '정리 끝';
  const title = (at?: string) => (at ? `${relative(at)} 녹음 · ${clock(at)}` : '녹음');
  return (
    <>
      <Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="secondary">녹음하면 맥이 글로 받아 적고, 회의록 문서로 정리해요. 할 만한 일이 보이면 결재로 제안해요.</div>
          {rec.startedAt
            ? <Button kind="danger" full onClick={() => void recorder.stop()}>녹음 끝내기</Button>
            : <Button kind="primary" full onClick={() => setConfirm(true)}>녹음 시작</Button>}
        </div>
      </Panel>
      {rec.pending.length > 0 && (
        <Panel>
          <CardHeader title="맥으로 보내는 중" />
          <List>{rec.pending.map((p) => <Row key={p.id} title={title(p.startedAt)} detail={`${duration(p.durationSec)} · ${Math.round(p.progress * 100)}% 보냄`} trailing={<div style={{ width: 60 }}><Meter value={p.progress} /></div>} />)}</List>
          {rec.problem && <div className="footnote">{rec.problem} <a className="link" onClick={() => void recorder.send()}>다시 보내기</a></div>}
        </Panel>
      )}
      {state.state === 'loaded' && state.value.recordings.length > 0 && (
        <Panel>
          <CardHeader title="회의록" />
          <List>
            {state.value.recordings.map((r) => (
              <Row key={r.id} title={r.title ?? title(r.startedAt)} titleClass={r.status === 'failed' ? 'red' : undefined}
                detail={[r.statusText ?? words(r), r.durationSec ? duration(r.durationSec) : null].filter(Boolean).join(' · ')}
                chevron={r.status === 'done' && !!r.documentId}
                trailing={r.status !== 'done' && r.status !== 'failed' ? <Spinner /> : undefined}
                onClick={r.status === 'done' && r.documentId ? () => go({ doc: r.documentId! }) : undefined} />
            ))}
          </List>
        </Panel>
      )}
      {state.state === 'failed' && <div className="footnote">{state.message}</div>}
      {confirm && (
        <Sheet title="녹음하기 전에" onClose={() => setConfirm(false)}>
          <div>내가 함께 있는 대화만 녹음할 수 있어요. 내가 빠진 다른 사람들의 대화를 몰래 녹음하면 안 돼요.</div>
          <div className="footnote">녹음은 맥의 ax-kit가 받아 글로 정리해요. 이 앱에는 남지 않아요.</div>
          <Button kind="primary" full onClick={() => { setConfirm(false); void recorder.start(); }}>알겠어요, 녹음할게요</Button>
          <Button kind="secondary" full onClick={() => setConfirm(false)}>취소</Button>
        </Sheet>
      )}
    </>
  );
}

// ---------- 서버가 그리는 화면 (R9) ----------
export function Blocks({ name }: { name: string }) {
  const { session } = useApp();
  // §38: rows with a `query` open the same screen with it (folders); the queries opened so far, for 뒤로.
  const [trail, setTrail] = useState<{ name: string; queries: Record<string, string>[] }>({ name, queries: [] });
  const queries = trail.name === name ? trail.queries : [];
  const current = queries[queries.length - 1];
  const key = JSON.stringify(current ?? null);
  const [state, reload] = useLoad(() => session.api.view<BlocksView>(name, current), [name, key]);
  const open = (q: Record<string, string>) => setTrail({ name, queries: Object.keys(q).length ? [...queries, q] : [] });
  const back = () => setTrail({ name, queries: queries.slice(0, -1) });
  useEffect(() => {
    if (!queries.length) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      if ((e.metaKey && e.key === '[') || (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Backspace')) { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const [forgetting, setForgetting] = useState<{ title: string; detail?: string } | null>(null);
  // §20 알아 둔 사이트: a site row can be forgotten. The Mac has no action for it, so it is asked for in chat.
  const isSites = (title?: string) => name === 'ways' && (title === '사이트' || title === 'Sites');
  return (
    <Loaded value={state} retry={reload}>
      {(v) => (
        <>
          {queries.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button kind="secondary" small onClick={back} title="뒤로 (⌘[ 또는 Backspace)">
                <span style={{ width: 12, height: 12, display: 'inline-flex' }}><Icon.back /></span> 뒤로
              </Button>
              {queries.length > 1 && <button className="btn plain small" onClick={() => setTrail({ name, queries: [] })}>처음으로</button>}
            </div>
          )}
          {v.blocks.map((b, i) => {
            switch (b.kind) {
              case 'text': return <div key={i} className="secondary" style={{ padding: '0 4px' }}><Markdown source={b.text ?? ''} /></div>;
              case 'stat': return <Panel key={i}><div className="secondary">{b.title}</div><div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{b.value}</div></Panel>;
              case 'list': return (
                <Panel key={i}>
                  {b.title && <CardHeader title={b.title} />}
                  <List>{(b.rows ?? []).map((r, j) => {
                    // §38: query (open in place) wins over message (ask in chat).
                    const query = rowQuery(r);
                    const message = query ? undefined : rowMessage(r);
                    return <Row key={j} title={r.title} detail={r.detail} chevron={!!query || !!message}
                      onClick={query ? () => open(query) : message ? () => { session.send(message, ''); session.say('비서에게 부탁했어요'); } : undefined}
                      trailing={isSites(b.title) ? <span onClick={(e) => e.stopPropagation()}><Button kind="danger" small onClick={() => setForgetting(r)}>잊기</Button></span> : r.trailing ? <span className="footnote">{r.trailing}</span> : undefined} />;
                  })}</List>
                </Panel>
              );
              case 'note': return <div key={i} className="footnote" style={{ padding: '0 4px' }}>{b.text}</div>;
              case 'ask': return <Button key={i} kind="primary" full onClick={() => { session.send(b.message ?? b.title ?? '', ''); session.say('비서에게 부탁했어요'); }}>{b.title ?? '비서에게 부탁하기'}</Button>;
              default: return null;
            }
          })}
          {forgetting && (
            <Sheet title="이 사이트 잊기" onClose={() => setForgetting(null)}>
              <div>'{forgetting.title}'을(를) 잊어 달라고 비서에게 말할게요. 다음부터는 이 사이트를 먼저 쓰지 않아요.</div>
              <Button kind="danger" full onClick={() => { session.send(forgetSiteMessage(forgetting), ''); session.say('비서에게 잊어 달라고 했어요'); setForgetting(null); }}>이 사이트 잊기</Button>
              <Button kind="secondary" full onClick={() => setForgetting(null)}>그대로 두기</Button>
            </Sheet>
          )}
        </>
      )}
    </Loaded>
  );
}

