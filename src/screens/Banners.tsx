import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { connectionLabel } from '../core/session';
import { recorder, useRecorder } from '../app/recorder';
import { Button } from '../ui/kit';
import { UpdateBanner } from './AppUpdate';

/** Stop switch (R10), lost connection, and recording — shown above a screen's content. */
export function Banners() {
  const { session, go } = useApp();
  const c = session.connection;
  return (
    <>
      {session.stopped && <div className="banner stop" role="status">전체 정지 중이에요. 보내기·결제·삭제는 맥에서 막혀 있어요.</div>}
      {(c === 'offline' || c === 'unauthorized') && (
        <div className="banner conn" role="status">
          <span className="dot" style={{ background: 'var(--red)' }} />
          <span>{connectionLabel[c]}</span>
          <span className="footnote" style={{ fontWeight: 400 }}>{session.info?.mode === 'remote'
            ? (c === 'offline' ? '다시 붙어 볼게요. 두 맥 모두 Tailscale이 켜져 있는지 확인해 주세요.' : '그 맥에서 짝 맞추기를 다시 해 주세요.')
            : (c === 'offline' ? '다시 붙어 볼게요.' : 'ax-kit를 다시 켜 주세요.')}</span>
          <span style={{ flex: 1 }} />
          <button className="btn plain small" onClick={() => go({ section: 'settings' })}>설정 보기</button>
        </div>
      )}
      <RecordingBar />
      <UpdateBanner />
    </>
  );
}

function RecordingBar() {
  const rec = useRecorder();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rec.startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rec.startedAt]);
  if (!rec.startedAt) return null;
  return (
    <div className="banner rec" role="status">
      <span className="dot" style={{ background: 'var(--red)' }} />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>녹음 중 {clockText((now - rec.startedAt) / 1000)}</span>
      <span style={{ flex: 1 }} />
      <Button kind="danger" small onClick={() => void recorder.stop()}>끝내기</Button>
    </div>
  );
}

export function clockText(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}
