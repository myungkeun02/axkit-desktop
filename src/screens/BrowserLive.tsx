import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react';
import { useApp } from '../app/context';
import { ApiError, errorText } from '../core/api';
import { closedLabel, hostOf, liveKeyFor, reasonLabel, toJpegPoint, toJpegScroll, type LiveFrame, type LiveState, afterDone } from '../core/browserLive';
import { upcoming } from '../core/format';
import { liveFrame, liveStream } from '../platform/tauri';
import { Button, Empty, Icon, Spinner } from '../ui/kit';
import { Banners } from './Banners';

/** §22 브라우저 화면: when the assistant's browser errand stops at a login, captcha, consent or the last button,
 * the owner sees that page here, clicks and types on it, then presses '다 했어요' so the assistant carries on.
 * Typed text goes only to the page (the Mac keeps no record of it). */
export function BrowserLive() {
  const { session, go } = useApp();
  const [state, setState] = useState<LiveState | null>(null);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [conn, setConn] = useState<'connecting' | 'live' | 'waiting' | 'unauthorized'>('connecting');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const writeBox = useRef<HTMLInputElement>(null);
  const [writing, setWriting] = useState(false);
  // Stream fallback (same as the iPhone app): after two failed connections, fetch a picture every 2 seconds.
  const failures = useRef(0);
  const [polling, setPolling] = useState(false);
  const [polled, setPolled] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const scrollAcc = useRef(0);
  const scrollTimer = useRef<number | null>(null);

  // Actions go out one at a time, in the order the owner made them: a quick tap → text → Enter must not overtake each other.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const act = (action: string, body: Record<string, unknown> = {}, quiet = false): Promise<unknown> => {
    const next = queue.current.then(() => send(action, body, quiet));
    queue.current = next.catch(() => null);
    return next;
  };
  const send = async (action: string, body: Record<string, unknown>, quiet: boolean): Promise<unknown> => {
    if (!quiet) setBusy(action);
    setProblem(null);
    try {
      let data = await session.api.viewAction<Record<string, unknown>>('browser-live', action, body);
      // More than 8 actions a second: the Mac asks to wait a moment, once.
      if (data?.accepted === false && typeof data.retryAfterMs === 'number') {
        await new Promise((r) => setTimeout(r, data.retryAfterMs as number));
        data = await session.api.viewAction<Record<string, unknown>>('browser-live', action, body);
      }
      return data;
    } catch (e) {
      setProblem(errorText(e));
      if (e instanceof ApiError && e.serverMessage?.includes('닫혀')) setState((s) => (s ? { ...s, live: false } : s));
      return null;
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  // Read the state; a page waiting to be handed over opens right away. The picture comes on the stream.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    void (async () => {
      try {
        const s = await session.api.view<LiveState>('browser-live');
        if (!alive) return;
        setState(s);
        if (!s.live && s.pending) {
          const opened = (await act('start')) as LiveState | null;
          if (opened && alive) setState(opened);
        }
      } catch (e) { setProblem(errorText(e)); }
      stop = await liveStream((event, data) => {
        if (event === 'connection') {
          setConn(data as typeof conn);
          if (data === 'waiting') { failures.current += 1; if (failures.current >= 2) setPolling(true); }
          if (data === 'live') { failures.current = 0; setPolling(false); }
          return;
        }
        try {
          if (event === 'state') {
            const s = JSON.parse(data) as LiveState;
            setState(s);
            if (!s.live) setFrame(null);
          }
          if (event === 'frame') setFrame(JSON.parse(data) as LiveFrame);
        } catch { /* a broken event is skipped */ }
      });
      if (!alive) stop();
    })();
    return () => { alive = false; stop?.(); };
  }, []);

  useEffect(() => {
    if (!polling || !state?.live) return;
    let alive = true;
    const tick = async () => {
      const url = await liveFrame();
      if (!alive) { if (url) URL.revokeObjectURL(url); return; }
      setPolled((old) => { if (old) URL.revokeObjectURL(old); return url; });
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => { alive = false; clearInterval(t); };
  }, [polling, state?.live]);

  // The picture: the stream's newest frame, or the polled one while the stream is down.
  const src = polling && polled ? polled : frame ? `data:image/jpeg;base64,${frame.jpeg}` : polled;
  const size = frame && !polling ? { w: frame.width, h: frame.height } : natural ?? (frame ? { w: frame.width, h: frame.height } : null);

  const tap = (e: MouseEvent<HTMLImageElement>) => {
    if (!size || !img.current) return;
    stage.current?.focus();
    const r = img.current.getBoundingClientRect();
    void act('tap', toJpegPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, size.w, size.h), true);
  };
  /** While the picture has focus, Enter·Backspace·Tab·Esc·arrows go straight to the page. Any other key (a letter, or
   * Korean input starting a syllable) moves focus into the always-mounted '글자 쓰기' box *before* the key lands, so the
   * text is written there whole and sent once with `type`. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = !e.nativeEvent.isComposing && e.key !== 'Process' ? liveKeyFor(e.key) : null;
    if (key) { e.preventDefault(); void act('key', { name: key }, true); return; }
    if (e.key.length === 1 || e.key === 'Process' || e.nativeEvent.isComposing) {
      writeBox.current?.focus();
      setWriting(true);
    }
  };
  const wheel = (e: WheelEvent<HTMLImageElement>) => {
    if (!size || !img.current) return;
    scrollAcc.current += toJpegScroll(e.deltaY, img.current.getBoundingClientRect().height, size.h);
    if (scrollTimer.current) return;
    // Wheel ticks are gathered and sent together, so a fling is a few requests, not dozens.
    scrollTimer.current = window.setTimeout(() => {
      const dy = scrollAcc.current;
      scrollAcc.current = 0;
      scrollTimer.current = null;
      if (dy) void act('scroll', { dy: Math.max(-4000, Math.min(4000, dy)) }, true);
    }, 250);
  };
  const sendText = async () => {
    const t = text;
    if (!t || t.length > 1000) return;
    // Empty the box right away so the next field's first key starts fresh; the text comes back only if it did not go.
    setText(''); setWriting(false); stage.current?.focus();
    const r = await act('type', { text: t });
    if (!r) { setText((now) => now || t); setWriting(true); }
  };
  const done = async () => {
    const r = (await act('done')) as (LiveState & { resumed?: boolean; continuedIn?: string; channel?: string }) | null;
    if (r) {
      // Back to the conversation the errand came from: its room, or the main chat. Discord carries on there; the main chat only gets a note, so go there.
      const next = afterDone(r);
      session.say(next.say);
      go(next.room ? { section: 'room', room: next.room } : { section: 'home' });
    }
  };

  const live = state?.live === true;
  const host = hostOf(frame?.url ?? state?.url);
  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>브라우저 화면</h1>
        <div className="side right">{live && <Button kind="primary" small busy={busy === 'done'} onClick={() => void done()}>다 했어요</Button>}</div>
      </header>
      <Banners />
      {!state ? (
        <div className="center-fill">{problem ? <Empty title="불러오지 못했어요" message={problem} /> : <Spinner />}</div>
      ) : !live ? (
        <div className="center-fill">
          <Empty icon={Icon.globe} title={state.pending ? '화면을 여는 중이에요' : '지금 넘겨받을 화면이 없어요'}
            message={closedLabel(state.closed) ?? '비서의 브라우저 심부름이 로그인이나 마지막 버튼에서 멈추면 여기서 그 페이지를 직접 누르고 쓸 수 있어요. "그 페이지 열어 줘"라고 해도 돼요.'}>
            {problem && <div className="footnote red">{problem}</div>}
            {state.pending && <Button kind="primary" busy={busy === 'start'} onClick={async () => { const s = (await act('start')) as LiveState | null; if (s) setState(s); }}>화면 열기</Button>}
            <Button kind="secondary" onClick={() => go({ section: 'home' })}>비서에게 가기</Button>
          </Empty>
        </div>
      ) : (
        <div className="live">
          <div className="live-top">
            <span className="bold">{host}</span>
            {state.idleClosesAt && <span className="secondary">{upcoming(state.idleClosesAt).replace(/^오늘 /, '')}까지 열려 있어요</span>}
            <span className="live-reason">{reasonLabel(state.reason)}</span>
            {conn === 'waiting' && <span className="footnote">{polling ? '2초마다 그림을 받는 중' : '다시 연결하는 중…'}</span>}
          </div>
          <div className="live-stage" tabIndex={0} ref={stage} onKeyDown={onKey} aria-label="브라우저 화면. 누르면 그 자리를 누르고, 이 칸에서 Enter·지우기·Tab·화살표는 그대로 보내요.">
            {src ? (
              <img ref={img} className="live-frame" src={src} alt={frame?.title ?? state.title ?? '브라우저 화면'} draggable={false}
                onClick={tap} onWheel={wheel} onLoad={(e) => { if (!frame) setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }} />
            ) : <div className="center-fill"><Spinner /><span>화면을 받는 중…</span></div>}
          </div>
          {/* Always mounted (folded when not writing) so a key press on the picture can move focus here in time. */}
          {(
            <div className={`live-write${writing ? '' : ' folded'}`} aria-hidden={!writing}>
              <input ref={writeBox} className="field" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)}
                placeholder="먼저 화면에서 칸을 누르고, 그 칸에 쓸 글을 다 쓴 뒤 보내요" aria-label="화면의 칸에 쓸 글" autoComplete="off" spellCheck={false}
                onFocus={() => setWriting(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void sendText(); } if (e.key === 'Escape') { setWriting(false); stage.current?.focus(); } }} />
              <Button kind="primary" busy={busy === 'type'} disabled={!text} onClick={() => void sendText()}>보내기</Button>
              <span className="footnote">쓴 글은 그 페이지로만 가요.</span>
            </div>
          )}
          {problem && <div className="footnote red" style={{ textAlign: 'center', padding: '4px 0' }}>{problem}</div>}
          <div className="live-bar" role="toolbar" aria-label="브라우저 조작">
            <button className="btn secondary small" onClick={() => void act('back', {}, true)}>뒤로</button>
            <button className={`btn small ${writing ? 'primary' : 'secondary'}`} aria-pressed={writing} onClick={() => { setWriting(!writing); setTimeout(() => writeBox.current?.focus(), 0); }}>글자 쓰기</button>
            <button className="btn secondary small" onClick={() => void act('key', { name: 'Enter' }, true)}>엔터</button>
            <button className="btn secondary small" onClick={() => void act('key', { name: 'Backspace' }, true)}>지우기</button>
            <button className="btn secondary small" onClick={() => void act('key', { name: 'Tab' }, true)}>다음 칸</button>
            <button className="btn secondary small" onClick={() => void act('scroll', { dy: -800 }, true)}>위로</button>
            <button className="btn secondary small" onClick={() => void act('scroll', { dy: 800 }, true)}>아래로</button>
          </div>
        </div>
      )}
    </>
  );
}
