import { useState } from 'react';
import { useApp } from '../app/context';
import { Button, CardHeader, Empty, Icon, Panel } from '../ui/kit';

// "이 맥의 비서" / "다른 맥의 비서에 연결" (the work MacBook talking to the Mac mini at home over Tailscale), and 도움말.

const PAIR_COMMAND = 'ax-kit phone pair --app --platform desktop --name "작업용 맥북"';

/** Paste the link from `ax-kit phone pair --app --platform desktop`, or type its three values. */
export function PairForm({ onDone }: { onDone?: () => void }) {
  const { session } = useApp();
  const [manual, setManual] = useState(false);
  const [link, setLink] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [nonce, setNonce] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = manual ? address.trim() && code.trim() && nonce.trim() : link.includes('axkit://pair');

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await session.pairRemote(manual ? { address, code, nonce } : { link });
      session.say('다른 맥의 비서에 연결했어요');
      onDone?.();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pair-form">
      <ol className="pair-steps">
        <li>비서가 도는 맥(예: 집의 맥미니)의 터미널에서 이렇게 쳐요:
          <code className="selectable pair-cmd">{PAIR_COMMAND}</code></li>
        <li>나온 <b>링크: axkit://pair?…</b> 한 줄을 복사해 아래에 붙여 넣어요. 10분 안에, 한 번만 쓸 수 있어요.</li>
      </ol>
      {manual ? (
        <div className="pair-fields">
          <label className="form-label">주소<input className="field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://macmini.tail1234.ts.net" spellCheck={false} autoCapitalize="off" /></label>
          <div className="pair-row">
            <label className="form-label">코드 (6자리)<input className="field" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" /></label>
            <label className="form-label">연결 id<input className="field" value={nonce} onChange={(e) => setNonce(e.target.value)} spellCheck={false} autoCapitalize="off" /></label>
          </div>
        </div>
      ) : (
        <textarea className="field pair-link" rows={3} value={link} onChange={(e) => setLink(e.target.value)} aria-label="짝 맞추기 링크"
          placeholder="링크: axkit://pair?u=…&n=…&c=…" spellCheck={false} />
      )}
      {problem && <div className="footnote" role="alert" style={{ color: 'var(--red)' }}>{problem}</div>}
      <div className="pair-actions">
        <Button kind="primary" busy={busy} disabled={!ready || busy} onClick={() => void connect()}>연결하기</Button>
        <button className="btn plain small" onClick={() => setManual(!manual)}>{manual ? '링크로 넣기' : '주소·코드를 직접 넣기'}</button>
      </div>
      <div className="footnote">연결 토큰은 이 맥의 키체인에만 저장돼요. 앱을 업데이트한 뒤 처음 열 때 키체인이 허락을 물으면 '항상 허용'을 눌러 주세요.</div>
    </div>
  );
}

/** Not connected yet: pick which assistant this Mac talks to. */
export function Welcome() {
  const { session, go } = useApp();
  const [busy, setBusy] = useState(false);
  const info = session.info;

  if (info?.mode === 'remote') {
    return (
      <>
        <header className="titlebar" data-tauri-drag-region><h1 data-tauri-drag-region>ax-kit</h1></header>
        <div className="scroll">
          <div className="welcome">
            <Empty icon={Icon.mac} title={`${info.host ?? '다른 맥'}의 비서에 닿지 않아요`} message={info.problem ?? '이 맥과 그 맥 모두 Tailscale이 켜져 있는지 확인해 주세요.'}>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
                <Button kind="primary" busy={busy} onClick={async () => { setBusy(true); await session.reconnect(); setBusy(false); }}>다시 연결해 보기</Button>
                <Button kind="secondary" onClick={() => go({ section: 'help' })}>도움말</Button>
              </div>
            </Empty>
            <Panel><CardHeader title="다시 짝 맞추기" subtitle="연결이 끊겼다고 나오면 그 맥에서 짝 맞추기를 다시 해요." /><PairForm /></Panel>
            <div style={{ textAlign: 'center' }}><button className="btn plain small" onClick={() => void session.forgetRemote()}>이 맥의 비서로 바꾸기</button></div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="titlebar" data-tauri-drag-region><h1 data-tauri-drag-region>ax-kit</h1></header>
      <div className="scroll">
        <div className="welcome">
          <div className="welcome-title">
            <h2>어느 비서와 연결할까요?</h2>
            <p className="secondary">비서(ax-kit 서버)가 이 맥에서 돌면 왼쪽, 집의 맥미니처럼 다른 맥에서 돌면 오른쪽이에요.</p>
          </div>
          <div className="welcome-choices">
            <Panel className="welcome-choice">
              <CardHeader title="이 맥의 비서" subtitle="이 맥에서 ax-kit를 켜면 짝 맞추기 없이 바로 붙어요." />
              <div className="footnote" style={{ margin: '10px 0' }}>{info?.problem ?? 'ax-kit 서버를 켜면 바로 붙어요.'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button kind="secondary" busy={busy} onClick={async () => { setBusy(true); await session.reconnect(); setBusy(false); }}>다시 연결해 보기</Button>
                {info?.devBuild && <Button kind="secondary" onClick={() => void session.switchTo({ mock: 'http://127.0.0.1:47795' })}>개발용 가짜 맥에 연결</Button>}
              </div>
              {info?.tokenFile && <div className="footnote" style={{ marginTop: 8 }}>연결 파일: <span className="selectable">{info.tokenFile}</span></div>}
            </Panel>
            <Panel className="welcome-choice">
              <CardHeader title="다른 맥의 비서에 연결" subtitle="작업용 맥북에서 집의 맥미니 비서를 쓸 때. 두 맥 모두 Tailscale이 켜져 있어야 해요." />
              <PairForm />
            </Panel>
          </div>
          <div style={{ textAlign: 'center' }}><button className="btn plain small" onClick={() => go({ section: 'help' })}>처음 쓰는 법 보기</button></div>
        </div>
      </div>
    </>
  );
}

/** 도움말: 처음 쓰는 법. */
export function Help() {
  return (
    <div className="help scroll">
      <Panel>
        <CardHeader title="1. 설치와 실행" />
        <ul>
          <li>받은 <b>ax-kit.app</b>을 <b>응용 프로그램</b>(/Applications) 폴더에 넣고 열어요. 처음엔 오른쪽 클릭 → 열기를 눌러야 할 수 있어요(정식 서명 전이라서).</li>
          <li>창을 닫아도 꺼지지 않아요. 메뉴 막대의 ax-kit 아이콘에 남아 결재 수를 보여 주고 맥 알림을 보내요. 끝내려면 ⌘Q.</li>
          <li><b>위젯</b>: 메뉴 막대 아이콘을 누르면 오늘 일정·할 일, 결재 대기, 최근 알림, 비서 상태, 한 줄 보내기 칸이 내려와요. '고정'을 누르면 화면 위에 계속 떠 있어요.</li>
          <li>어디서든 ⌘K로 아무 화면이나 찾아 가요.</li>
        </ul>
      </Panel>
      <Panel>
        <CardHeader title="2. 이 맥의 비서" />
        <ul>
          <li>비서(ax-kit 서버)가 이 맥에서 돌면 따로 할 일이 없어요. 서버가 켜질 때 쓰는 연결 파일(~/.ax-kit/desktop.token)을 앱이 읽어 바로 붙어요.</li>
        </ul>
      </Panel>
      <Panel>
        <CardHeader title="3. 다른 맥의 비서에 연결 (작업용 맥북 → 집의 맥미니)" />
        <ol>
          <li>두 맥 모두 <b>Tailscale</b>을 깔고 <b>같은 계정</b>으로 로그인해요.</li>
          <li>맥미니의 ax-kit가 Tailscale 주소로 열려 있어야 해요. 보통 https://&lt;맥미니 이름&gt;.&lt;tailnet&gt;.ts.net 이에요(ax-kit 설정의 공개 주소).</li>
          <li>맥미니 터미널에서 <code className="selectable">{PAIR_COMMAND}</code></li>
          <li>나온 <b>링크: axkit://pair?…</b> 한 줄을 맥북의 ax-kit 첫 화면(또는 설정 및 연결)의 '다른 맥의 비서에 연결'에 붙여 넣고 '연결하기'. 링크가 안 되면 같이 나온 주소·코드·연결 id를 직접 넣어요.</li>
          <li>코드는 10분 안에 한 번만 쓸 수 있어요. 5번 틀리면 못 쓰니 다시 만들어요.</li>
          <li>연결 토큰은 맥북의 키체인에만 있어요. 그만 쓰려면 설정 및 연결에서 '연결 끊기'를 누르면 맥미니에서도 바로 지워져요.</li>
        </ol>
      </Panel>
      <Panel>
        <CardHeader title="4. 연결이 안 될 때" />
        <ul>
          <li><b>닿지 않아요</b>: 맥북과 맥미니 모두 Tailscale이 켜져 있는지(메뉴 막대의 Tailscale 아이콘이 Connected), 같은 계정(tailnet)인지 봐요. 맥미니가 잠자기 상태가 아닌지, ax-kit가 켜져 있는지도 봐요.</li>
          <li>맥북 터미널에서 <code className="selectable">tailscale ping &lt;맥미니 이름&gt;</code>이 되면 네트워크는 괜찮아요. 그다음은 주소(https·포트)를 확인해요.</li>
          <li><b>코드가 지났어요·이미 썼어요</b>: 맥미니에서 짝 맞추기를 다시 해서 새 링크를 붙여 넣어요.</li>
          <li><b>연결을 받지 않아요</b>: 맥미니에서 이 기기를 지웠거나 토큰이 바뀌었어요. 짝 맞추기를 다시 해요.</li>
          <li>http 주소는 Tailscale(100.x)·집 안 주소만 받아요. 밖에서 열린 주소는 https여야 해요.</li>
          <li>키체인이 허락을 물으면 '항상 허용'을 눌러요(앱을 업데이트할 때마다 한 번 물을 수 있어요).</li>
        </ul>
      </Panel>
    </div>
  );
}
