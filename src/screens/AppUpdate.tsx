import { useState } from 'react';
import { useApp } from '../app/context';
import { fileSize } from '../core/format';
import type { DesktopBuild } from '../core/appUpdate';
import { installRelease, installUpdate } from '../platform/tauri';
import { Button, CardHeader, Panel } from '../ui/kit';

/** Where the new copy comes from, in a few words. */
const fromWhere = (u: DesktopBuild) => (u.source === 'github' ? 'GitHub에 올라온 새 앱이에요' : '비서 맥이 만든 새 앱이에요');

/** 바꾸기: Rust fetches the build (from the Mac or the GitHub release), checks it, and the app reopens as the new one. */
function useInstall() {
  const { session } = useApp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    const u = session.update;
    if (!u) return;
    setBusy(true); setProblem(null);
    try {
      await (u.source === 'github' ? installRelease(u.build) : installUpdate(u.sha256));
      session.say('새 버전으로 다시 여는 중이에요…');
    } catch (e) {
      setProblem(`${typeof e === 'string' ? e : '바꾸지 못했어요.'} 지금 앱은 그대로예요.`);
      setBusy(false);
    }
  };
  return { busy, problem, run };
}

/** Above the screen while a newer build waits (hidden for this run with 나중에). */
export function UpdateBanner() {
  const { session } = useApp();
  const [later, setLater] = useState<number | null>(null);
  const { busy, problem, run } = useInstall();
  const u = session.update;
  if (!u || later === u.build) return null;
  return (
    <div className="banner update" role="status">
      <span className="bold">새 버전 있어요</span>
      <span className="footnote" style={{ fontWeight: 400 }}>{problem ?? `${u.versionName} · ${fromWhere(u)}. 바꾸면 잠깐 닫혔다 다시 열려요.`}</span>
      <span style={{ flex: 1 }} />
      {!busy && <button className="btn plain small" onClick={() => setLater(u.build)}>나중에</button>}
      <Button kind="primary" small busy={busy} onClick={() => void run()}>업데이트</Button>
    </div>
  );
}

/** 설정 및 연결: which build this is, and the newer one if there is. */
export function UpdateSettings() {
  const { session } = useApp();
  const { busy, problem, run } = useInstall();
  const u = session.update;
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const check = async () => { setChecking(true); await session.refreshUpdate(); setChecking(false); setChecked(true); };
  return (
    <Panel>
      <CardHeader title="앱 업데이트" subtitle={`지금 빌드 ${session.appBuild || '개발용'}`}
        right={u ? <Button kind="primary" small busy={busy} onClick={() => void run()}>업데이트</Button>
          : <Button kind="secondary" small busy={checking} onClick={() => void check()}>확인</Button>} />
      {u && <div className="footnote">새 버전 {u.versionName} (빌드 {u.build}, {fileSize(u.size)}) · {fromWhere(u)}. 바꾸면 앱이 잠깐 닫혔다 다시 열리고, 연결은 그대로예요.</div>}
      {!u && <div className="footnote">{checked ? '최신 버전이에요.' : 'GitHub와 비서 맥에서 하루 한 번 새 버전을 찾아요.'}</div>}
      {problem && <div className="footnote" role="alert" style={{ color: 'var(--red)', marginTop: 6 }}>{problem}</div>}
    </Panel>
  );
}
