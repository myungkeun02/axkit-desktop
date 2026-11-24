import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { connectionLabel, type Session } from '../core/session';
import { hasView } from '../core/api';
import { clock, relative, subject } from '../core/format';
import type { TodayView } from '../core/views';
import { busyLine, nextEvents, plainLine, recentNotes, todoLines, waitingCards } from '../core/widget';
import { rememberWidgetPinned, widgetHide, widgetOpenMain, widgetPin, widgetPinned } from '../platform/tauri';
import { Icon } from '../ui/kit';

const REFRESH_MS = 5 * 60_000;

/** The widget window: 오늘 일정·할 일, 결재 대기, 최근 알림, 비서 상태, and a box to message the assistant. */
export function Widget({ session }: { session: Session }) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const [today, setToday] = useState<TodayView | null>(null);
  const [todayFailed, setTodayFailed] = useState(false);
  const [pinned, setPinned] = useState(widgetPinned);
  const [now, setNow] = useState(Date.now);
  const hasToday = hasView(session.capabilities, 'today');

  const load = useCallback(async () => {
    setNow(Date.now());
    void session.refreshWork();
    if (!hasView(session.capabilities, 'today')) return;
    try { setToday(await session.api.view<TodayView>('today')); setTodayFailed(false); } catch { setTodayFailed(true); }
  }, [session]);

  // Each time it drops down, and every five minutes while it stays up (pinned).
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load, session.connection, hasToday]);

  useEffect(() => { if (pinned) void widgetPin(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pinned) void widgetHide(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  const togglePin = () => {
    const on = !pinned;
    setPinned(on);
    rememberWidgetPinned(on);
    void widgetPin(on);
  };

  const live = session.connection === 'live';
  const busy = busyLine(session.activity, (r) => session.roomTitle(r), session.assistantName, now);
  const waiting = waitingCards(session.timeline, today);
  const events = nextEvents(today, now);
  const todos = todoLines(today);
  const notes = recentNotes(session.timeline);

  return (
    <div className="widget">
      <header className="widget-head" data-tauri-drag-region>
        <span className="dot" style={{ background: live ? 'var(--green)' : session.connection === 'connecting' ? 'var(--orange)' : 'var(--red)' }}
          title={connectionLabel[session.connection]} aria-label={connectionLabel[session.connection]} />
        <strong data-tauri-drag-region>{session.assistantName}</strong>
        <span className="grow" data-tauri-drag-region />
        <button className={`pill-btn small${pinned ? ' on' : ''}`} onClick={togglePin} aria-pressed={pinned}
          title={pinned ? '고정을 풀면 메뉴 막대 아이콘을 누를 때만 나와요' : '화면 위에 계속 띄워 둬요 (끌어서 옮길 수 있어요)'}>{pinned ? '고정됨' : '고정'}</button>
        <button className="pill-btn small" onClick={() => void widgetOpenMain('home')}>앱 열기</button>
        {pinned && <button className="widget-x" onClick={() => void widgetHide()} aria-label="위젯 닫기" title="닫기 (메뉴 막대 아이콘으로 다시 열어요)">×</button>}
      </header>

      <div className="widget-body scroll">
        {!live && <div className="widget-line secondary">{connectionLabel[session.connection]}</div>}

        <div className={`widget-status${busy ? ' activity' : ''}`} role="status" aria-live="polite">
          {session.stopped
            ? <span>{subject(session.assistantName)} 멈춰 있어요</span>
            : busy
              ? <span>{busy}<span className="dots" aria-hidden><i /><i /><i /></span></span>
              : <span className="secondary">{session.assistantName} 대기 중</span>}
        </div>

        <button className={`widget-cards${waiting ? ' on' : ''}`} onClick={() => void widgetOpenMain(waiting ? 'approvals' : 'home')}>
          <span>결재 대기</span>
          <strong>{waiting ? `${waiting}개` : '없어요'}</strong>
          {waiting > 0 && <Icon.chevron />}
        </button>

        {session.work && session.work.active.length > 0 && (
          <button className="widget-cards" onClick={() => void widgetOpenMain('work')}>
            <span className="widget-text">하고 있는 일 · {session.work.active[0].title}{session.work.active[0].phase ? ` · ${session.work.active[0].phase}` : ''}</span>
            <strong>{session.work.active.length}개</strong>
            <Icon.chevron />
          </button>
        )}

        {hasToday && (
          <>
            <section className="widget-section">
              <h2>오늘 일정</h2>
              {todayFailed && !today ? <p className="secondary">오늘 일정을 불러오지 못했어요.</p>
                : today?.events === null ? <p className="secondary">캘린더가 아직 연결되지 않았어요.</p>
                : events.items.length === 0 ? <p className="secondary">{today ? '남은 일정이 없어요.' : '불러오는 중…'}</p>
                : (
                  <ul>
                    {events.items.map((e, i) => (
                      <li key={i}><button onClick={() => void widgetOpenMain('calendar')}>
                        <span className="widget-time">{e.allDay ? '종일' : clock(e.start)}</span><span className="widget-text">{e.title}</span>
                      </button></li>
                    ))}
                    {events.more > 0 && <li className="secondary small">그 밖에 {events.more}개</li>}
                  </ul>
                )}
            </section>
            <section className="widget-section">
              <h2>할 일</h2>
              {todos.items.length === 0 ? <p className="secondary">{today ? '오늘 할 일이 없어요.' : todayFailed ? '할 일을 불러오지 못했어요.' : '불러오는 중…'}</p> : (
                <ul>
                  {todos.items.map((t, i) => <li key={i} className="widget-todo"><span className="widget-box" aria-hidden /><span className="widget-text">{t.text}</span></li>)}
                  {todos.more > 0 && <li className="secondary small">그 밖에 {todos.more}개</li>}
                </ul>
              )}
            </section>
          </>
        )}

        <section className="widget-section">
          <h2>최근 알림</h2>
          {notes.length === 0 ? <p className="secondary">새 알림이 없어요.</p> : (
            <ul>
              {notes.map((n) => (
                <li key={n.seq}><button onClick={() => void widgetOpenMain('home')}>
                  <span className="widget-text two">{n.room ? `${session.roomTitle(n.room)} · ` : ''}{n.text}</span>
                  <span className="widget-time">{relative(n.at, now)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <QuickMessage session={session} />
    </div>
  );
}

/** One line to the assistant (the main room). The answer shows here in one line; the whole thing is in the app. */
function QuickMessage({ session }: { session: Session }) {
  const [draft, setDraft] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onFocus = () => box.current?.focus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const send = () => {
    if (!draft.trim()) return;
    session.send(draft, '');
    setDraft('');
    setSentAt(Date.now());
  };

  const pending = session.pendingIn('').length > 0;
  const reply = sentAt === null ? null : latestReply(session, sentAt);
  const writable = session.canWrite('');

  return (
    <footer className="widget-foot">
      {sentAt !== null && (
        <button className="widget-reply" onClick={() => void widgetOpenMain('home')} title="앱에서 보기">
          {pending ? <span className="secondary">보내는 중…</span>
            : reply ? <span className="widget-text two">{reply}</span>
            : <span className="secondary">보냈어요. 답이 오면 여기에 보여요.</span>}
        </button>
      )}
      <div className="widget-input">
        <input ref={box} className="field" value={draft} disabled={!writable} aria-label={`${session.assistantName}에게 메시지`}
          placeholder={`${session.assistantName}에게 한 줄 보내기`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button className="send-btn" disabled={!draft.trim()} onClick={send} aria-label="보내기" title="보내기 (Enter)"><Icon.up /></button>
      </div>
    </footer>
  );
}

/** The assistant's newest reply in the main room after `since`, in one plain line. */
function latestReply(session: Session, since: number): string | null {
  const items = session.timeline.items('');
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'message' && it.event.role === 'assistant') {
      return Date.parse(it.event.at) >= since - 5_000 ? plainLine(it.event.text, 140) : null;
    }
  }
  return null;
}
