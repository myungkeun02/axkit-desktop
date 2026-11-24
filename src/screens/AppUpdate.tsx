import { useState } from 'react';
import { useApp } from '../app/context';
import { fileSize } from '../core/format';
import { installUpdate } from '../platform/tauri';
import { Button, CardHeader, Panel } from '../ui/kit';

/** 바꾸기: Rust fetches the Mac's build, checks it, and the app reopens as the new one. */
function useInstall() {
  const { session } = useApp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    const u = session.update;
    if (!u) return;
    setBusy(true); setProblem(null);
    try {
      await installUpdate(u.sha256);
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
      <span className="bold">새 버전이 있어요</span>
      <span className="footnote" style={{ fontWeight: 400 }}>{problem ?? `${u.versionName} · 비서 맥이 만든 새 앱이에요. 바꾸면 잠깐 닫혔다 다시 열려요.`}</span>
      <span style={{ flex: 1 }} />
      {!busy && <button className="btn plain small" onClick={() => setLater(u.build)}>나중에</button>}
      <Button kind="primary" small busy={busy} onClick={() => void run()}>바꾸기</Button>
    </div>
  );
}

/** 설정 및 연결: which build this is, and the newer one if there is. */
export function UpdateSettings() {
  const { session } = useApp();
  const { busy, problem, run } = useInstall();
  const u = session.update;
  const offers = session.capabilities.features.includes('app-updates');
  return (
    <Panel>
      <CardHeader title="앱 업데이트" subtitle={`지금 빌드 ${session.appBuild || '개발용'}${offers ? '' : ' · 이 맥의 비서는 아직 새 앱을 나눠 주지 않아요'}`}
        right={u ? <Button kind="primary" small busy={busy} onClick={() => void run()}>바꾸기</Button>
          : offers ? <Button kind="secondary" small onClick={() => void session.refreshUpdate()}>확인</Button> : undefined} />
      {u && <div className="footnote">새 버전 {u.versionName} (빌드 {u.build}, {fileSize(u.size)}). 바꾸면 앱이 잠깐 닫혔다 다시 열리고, 연결은 그대로예요.</div>}
      {!u && offers && <div className="footnote">최신 버전이에요.</div>}
      {problem && <div className="footnote" role="alert" style={{ color: 'var(--red)', marginTop: 6 }}>{problem}</div>}
    </Panel>
  );
}
