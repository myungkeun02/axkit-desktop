import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { cardLine, cleanText, previewText } from '../core/chatText';
import { buildFeed, type Entry, type Folded, type Row } from '../core/roomFeed';
import { useApp } from '../app/context';
import { hasFeature } from '../core/api';
import { closedLabel } from '../core/cards';
import type { Attachment, CardEvent, Choice, DelegationEvent, MessageEvent, NoticeEvent } from '../core/events';
import { clock, fileSize, subject } from '../core/format';
import { allBots, botFor, groupForMeeting, teamFor, type BotsView } from '../core/views';
import { handsOver } from '../core/browserLive';
import { workNoticeLabel } from '../core/work';
import { activityLine } from '../core/activity';
import { clockLabel, insertDictation } from '../core/dictation';
import { insertMention, mentionAt, mentionMatches } from '../core/mention';
import { useDictation } from '../app/dictation';
import { fileUrl, openLink, previewFile, revealFile, saveFile, type SavedFile } from '../platform/tauri';
import { BotAvatar } from '../ui/BotAvatar';
import { Empty, Icon, Markdown } from '../ui/kit';

/** Place of a name in the bot list (assistant first), so neighbouring bots get different colours and faces. */
export function ordinalOf(bots: BotsView | null, idOrRoom: string): number | undefined {
  if (!idOrRoom) return 0;
  const list = allBots(bots);
  const i = list.findIndex((b) => b.id === idOrRoom || b.channel === idOrRoom);
  return i >= 0 ? i + 1 : undefined;
}

/** "conversation" = a team or meeting room: every line shows who spoke (and to whom), like a group chat. */
export function roomStyle(bots: BotsView | null, room: string, botTalk = false): 'main' | 'conversation' | 'bot' {
  if (!room) return 'main';
  // ax-hq has no teams[]: its lead rooms hold bot-to-bot talk when the server has `bot-talk`.
  if (teamFor(bots, room) || groupForMeeting(bots, room) || room.startsWith('meeting:') || botTalk) return 'conversation';
  return 'bot';
}

// ---------- one room ----------
export function ChatRoom({ room, compactWidth, tray }: { room: string; compactWidth?: boolean; tray?: React.ReactNode }) {
  const { session } = useApp();
  const items = session.timeline.items(room);
  const pending = session.pendingIn(room);
  const bot = botFor(session.bots, room);
  const team = teamFor(session.bots, room);
  const meeting = groupForMeeting(session.bots, room);
  const style = roomStyle(session.bots, room, hasFeature(session.capabilities, 'bot-talk'));
  const writable = session.canWrite(room);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [dragging, setDragging] = useState(false);
  const canShare = !room && hasFeature(session.capabilities, 'share');

  // §4 activity: "생각하는 중…" / "메일 보는 중…" under the conversation while the assistant works on it.
  const busy = session.activity.get(room);
  const busyLine = busy ? activityLine(busy) : null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length, pending.length, items[items.length - 1]?.seq, busyLine]);

  // Read only when the owner can see it: the window in front and visible. Keyed on the newest seq (a full room
  // keeps 1000 lines, so its length stops changing), and again when the window comes back to the front.
  const newest = items[items.length - 1]?.seq ?? 0;
  useEffect(() => {
    const mark = () => { if (document.visibilityState === 'visible' && document.hasFocus()) session.markRead(room); };
    mark();
    window.addEventListener('focus', mark);
    document.addEventListener('visibilitychange', mark);
    return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark); };
  }, [session, room, newest]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (canShare) await sendFiles(session, Array.from(e.dataTransfer.files));
  };
  const lastBot = [...items].reverse().find((i) => i.kind === 'message' && i.event.role === 'assistant')?.seq;
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const lead = room && !meeting && bot ? { id: bot.id, name: bot.name, avatar: bot.avatar } : null;
  const rows = useMemo(() => buildFeed(items, room, { lead, assistant: session.assistantName, cardDate: (id) => session.timeline.card(id)?.at }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, items.length, items[items.length - 1]?.seq, room, lead?.id, session.assistantName]);
  const recent = new Set(items.slice(-2).map((i) => i.seq));
  const [menu, setMenu] = useState<{ x: number; y: number; m: MessageEvent } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [menu]);

  const placeholder = meeting ? `${meeting.label} 팀장회의에 끼어들기`
    : team ? `${team.name}에게 바로 지시하기`
    : bot ? `${bot.name}에게 바로 지시하기`
    : `${session.assistantName}에게 무엇이든 말해 보세요`;

  return (
    <>
      <div className="scroll" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        onDragOver={(e) => { if (canShare) { e.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        style={dragging ? { outline: '2px dashed var(--accent)', outlineOffset: -8 } : undefined}>
        <div className={`chat${compactWidth ? ' narrow' : ''}`}>
          {items.length === 0 && pending.length === 0 && <RoomIntro room={room} />}
          {rows.map((row) => <RowView key={row.key} row={row} room={room} recent={recent} faces={style !== 'main'} latest={lastBot}
            open={openFolds.has(row.key)} toggle={() => setOpenFolds((s) => { const n = new Set(s); if (n.has(row.key)) n.delete(row.key); else n.add(row.key); return n; })}
            onMenu={(x, y, m) => setMenu({ x, y, m })} />)}
          {pending.map((p) => (
            <div key={p.id} className="msg owner">
              <div className={`bubble owner pending selectable${p.failed ? ' failed' : ''}`}>{p.text}</div>
              {p.failed ? (
                <span className="footnote failed-line" role="alert">
                  <span>보내지 못했어요. {p.failed}</span>
                  <button className="btn plain small" onClick={() => session.resend(p.id)}>다시 보내기</button>
                  <button className="btn plain small" onClick={() => session.discard(p.id)}>지우기</button>
                </span>
              ) : <span className="footnote">{session.connection === 'live' ? '보내는 중…' : '맥이 연결되면 보낼게요'}</span>}
            </div>
          ))}
          {busyLine && (
            <div className="msg" role="status" aria-live="polite">
              <div className="bubble assistant activity">{busyLine}<span className="dots" aria-hidden><i /><i /><i /></span></div>
            </div>
          )}
        </div>
      </div>
      {tray && <div className="tray-wrap">{tray}</div>}
      {writable
        ? <Composer room={room} placeholder={placeholder} canAttach={canShare} onSent={() => { stick.current = true; }} />
        : <div className="composer"><div className="inner footnote" style={{ justifyContent: 'center', padding: '8px 0' }}>이 방은 읽기만 해요. 하고 싶은 말은 {session.assistantName}에게 해 주세요.</div></div>}
      {menu && <MessageMenu x={menu.x} y={menu.y} m={menu.m} onDone={() => setMenu(null)} />}
    </>
  );
}

function RoomIntro({ room }: { room: string }) {
  const { session } = useApp();
  const bot = botFor(session.bots, room);
  const team = teamFor(session.bots, room);
  const meeting = groupForMeeting(session.bots, room);
  if (meeting) return <Empty icon={Icon.people} title={`${meeting.label} 팀장회의`} message={'팀장들이 여기서 의논해요. 오른쪽 위 "회의 열기"로 안건을 줄 수 있어요.'} />;
  if (team || bot) {
    const name = team?.name ?? bot!.name;
    return (
      <div className="intro">
        <BotAvatar name={bot?.name ?? name} size={88} avatar={bot?.avatar} status={bot?.status} ordinal={ordinalOf(session.bots, room)} />
        <div className="name">{name}</div>
        {(team?.purpose ?? bot?.role) && <div>{team?.purpose ?? bot?.role}</div>}
        <div className="footnote" style={{ marginTop: 6 }}>여기에 쓰면 {team ? `${team.name} 팀장` : bot!.name}에게 바로 가요.</div>
      </div>
    );
  }
  return <Empty icon={Icon.bubble} title="무엇이든 말해 보세요" message={'예: "내일 일정 알려 줘", "앱 버그 고쳐 줘", "원두 주문해 줘"\n알맞은 팀이 있으면 비서가 알아서 맡겨요.'} />;
}

function Composer({ room, placeholder, onSent, canAttach }: { room: string; placeholder: string; onSent: () => void; canAttach?: boolean }) {
  const { session } = useApp();
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { box.current?.focus(); }, [room]);
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useLayoutEffect(fit, [draft]);
  // Measured again when the box gets wider or narrower (window resize, the work panel folding, a squeezed first paint).
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    if (!draft.trim()) return;
    session.send(draft, room);
    setDraft('');
    onSent();
  };
  // §31 '@': pick a bot by name; the Mac hands that bot a written-up instruction.
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const mention = mentionAt(draft, caret);
  const matches = mention && dismissedAt !== mention.start
    ? mentionMatches(allBots(session.bots).map((b) => ({ name: b.name, detail: b.role ?? session.roomTitle(b.channel) })), mention.query)
    : [];
  useEffect(() => { setPick(0); }, [mention?.start, mention?.query]);
  const choose = (name: string) => {
    if (!mention) return;
    const next = insertMention(draft, mention.start, caret, name);
    setDraft(next.value);
    setCaret(next.caret);
    requestAnimationFrame(() => { const b = box.current; if (b) { b.focus(); b.setSelectionRange(next.caret, next.caret); } });
  };
  const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);
  // §30: the words go where the caret is; the owner reads them, fixes them and sends.
  const canDictate = hasFeature(session.capabilities, 'dictation');
  const dictation = useDictation(session, (text) => {
    const el = box.current;
    const at = el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] as const : [null, null] as const;
    setDraft((d) => {
      const next = insertDictation(d, at[0], at[1], text);
      requestAnimationFrame(() => { const b = box.current; if (b) { b.focus(); b.setSelectionRange(next.caret, next.caret); } });
      return next.value;
    });
  });
  useEffect(() => {
    if (!canDictate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); dictation.toggle(); }
      else if (e.key === 'Escape' && dictation.phase !== 'idle') { e.preventDefault(); dictation.cancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDictate, dictation]);
  return (
    <div className="composer">
      {dictation.problem && <div className="dictation-note" role="alert" onClick={dictation.clearProblem}>{dictation.problem}</div>}
      <div className="inner">
        {canAttach && (
          <>
            <button className="attach-btn" onClick={() => picker.current?.click()} aria-label="사진·파일 보내기" title="사진·파일 보내기 (끌어다 놓아도 돼요, 12MB까지)"><Icon.plus /></button>
            <input ref={picker} type="file" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void sendFiles(session, files); }} />
          </>
        )}
        {matches.length > 0 && (
          <div className="mention-list" role="listbox" aria-label="봇 고르기">
            {matches.map((m, i) => (
              <button key={m.name} role="option" aria-selected={i === pick} className={`mention-item${i === pick ? ' on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); choose(m.name); }} onMouseEnter={() => setPick(i)}>
                <span className="bold">@{m.name}</span>{m.detail && <span className="secondary"> · {m.detail}</span>}
              </button>
            ))}
          </div>
        )}
        <textarea ref={box} className="field" rows={1} value={draft} placeholder={placeholder} aria-label="메시지"
          aria-autocomplete="list" aria-expanded={matches.length > 0}
          onChange={(e) => { setDraft(e.target.value); track(e.target); setDismissedAt(null); }}
          onSelect={(e) => track(e.currentTarget)}
          onKeyDown={(e) => {
            if (matches.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick((pick + 1) % matches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setPick((pick - 1 + matches.length) % matches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[Math.min(pick, matches.length - 1)].name); return; }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissedAt(mention!.start); return; }
            }
            // Korean input: Enter while composing a syllable must not send.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />
        {canDictate && <MicButton phase={dictation.phase} elapsed={dictation.elapsed} level={dictation.level} onClick={dictation.toggle} />}
        <button className="send-btn" disabled={!draft.trim()} onClick={send} aria-label="보내기" title="보내기 (Enter, 줄바꿈은 Shift+Enter)"><Icon.up /></button>
      </div>
    </div>
  );
}

function MicButton({ phase, elapsed, level, onClick }: { phase: 'idle' | 'recording' | 'transcribing'; elapsed: number; level: number; onClick: () => void }) {
  const label = phase === 'recording' ? '받아쓰기 멈추기 (⌘⇧M, 취소는 Esc)' : phase === 'transcribing' ? '받아쓰는 중이에요. 누르면 그만둬요.' : '말로 쓰기 (⌘⇧M)';
  return (
    <button className={`mic-btn ${phase}`} onClick={onClick} aria-label={label} title={label} aria-pressed={phase === 'recording'}>
      {phase === 'recording' ? <><span className="rec-dot" aria-hidden /><span className="mic-clock">{clockLabel(elapsed)}</span>
        <span className="mic-level" aria-hidden title="마이크 소리 크기"><span style={{ transform: `scaleY(${Math.max(0.08, level)})` }} /></span></>
        : phase === 'transcribing' ? <span className="mic-spin" aria-hidden />
          : <Icon.mic />}
    </button>
  );
}

type MenuOpener = (x: number, y: number, m: MessageEvent) => void;

function RowView({ row, room, recent, faces, latest, open, toggle, onMenu }: { row: Row; room: string; recent: Set<number>; faces: boolean; latest?: number; open: boolean; toggle: () => void; onMenu: MenuOpener }) {
  const { session } = useApp();
  switch (row.kind) {
    case 'day': return <div className="day-line" role="separator"><span>{row.label}</span></div>;
    case 'entry': return <EntryView e={row.entry} room={room} faces={faces} showChoices={recent.has(row.entry.seq)} latest={latest} onMenu={onMenu} />;
    case 'folded': return <FoldedRun fold={row.fold} room={room} open={open} toggle={toggle} onMenu={onMenu} />;
    case 'system': {
      const item = row.item;
      if (item.kind === 'notice') return <NoticeLine n={item.event} room={room} showChoices={recent.has(item.seq)} />;
      if (item.kind === 'delegation') return <DelegationLine d={item.event} />;
      if (item.kind === 'card') {
        const card = session.timeline.card(item.cardId);
        if (!card || session.timeline.isDuplicate(item.cardId)) return null;
        return <CardLine card={card} />;
      }
      return null;
    }
  }
}

/** Long text shows its first lines and "더 보기". */
function LongText({ text, lines = 10 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 60 || text.split('\n').length > lines;
  return (
    <>
      <div className={long && !open ? 'clamp' : undefined} style={long && !open ? { WebkitLineClamp: lines } : undefined}><Markdown source={text} /></div>
      {long && <button className="more-btn" onClick={() => setOpen((o) => !o)}>{open ? '접기' : '더 보기'}</button>}
    </>
  );
}

/** One line in a room: face and name on the first of a run, who it was said to, the bubble, replies folded below. */
function EntryView({ e, room, faces, showChoices, latest, onMenu, compact }: { e: Entry; room: string; faces: boolean; showChoices: boolean; latest?: number; onMenu: MenuOpener; compact?: boolean }) {
  const { session } = useApp();
  const [repliesOpen, setRepliesOpen] = useState(false);
  if (e.speaker.isOwner) {
    return (
      <div className="msg owner">
        <div className="bubble owner selectable" title={clock(e.at)}><LongText text={e.text} lines={12} /></div>
        {e.showHeader && <span className="footnote">{clock(e.at)}</span>}
      </div>
    );
  }
  const m = e.item.kind === 'message' ? e.item.event : null;
  const n = e.item.kind === 'notice' ? e.item.event : null;
  const bot = allBots(session.bots).find((b) => b.name === e.speaker.name || b.id === e.speaker.id);
  const size = compact ? 26 : 34;
  return (
    <div className={`convo bot-msg${e.showHeader ? '' : ' grouped'}${faces ? '' : ' no-face'}`} onContextMenu={(ev) => { if (m) { ev.preventDefault(); onMenu(ev.clientX, ev.clientY, m); } }}>
      {faces && <div className="convo-face" style={{ width: size }}>{e.showHeader && <BotAvatar name={e.speaker.name} size={size} avatar={e.speaker.avatar ?? bot?.avatar} status={bot?.status} ordinal={ordinalOf(session.bots, bot?.id ?? '')} />}</div>}
      <div className="convo-body">
        {e.showHeader && (faces || e.to) && (
          <div className="convo-head">
            <span className="bold">{e.speaker.name}</span>
            {e.to && <><span className="secondary">→</span><span>{e.to}</span></>}
            {e.label && <span className="chip">{e.label}</span>}
            <span className="footnote">{clock(e.at)}</span>
          </div>
        )}
        {e.threadTitle && <div className="footnote bold">{previewText(e.threadTitle, 60)}</div>}
        {n && workNoticeLabel(n.kind) && !(e.showHeader && (faces || e.to)) && <span className="chip work-chip">{workNoticeLabel(n.kind)}</span>}
        {e.text && (
          <div className={`bubble assistant${e.isStatus ? ' status' : ''}`} title={clock(e.at)}>
            <LongText text={e.text} lines={e.isStatus ? 4 : 10} />
            {e.repeats > 1 && <span className="footnote" style={{ marginLeft: 6 }}>×{e.repeats}</span>}
          </div>
        )}
        {(() => {
          const counts = session.timeline.reactions.get(e.seq);
          return counts && counts.size ? <div className="reactions">{[...counts].sort((a, b) => b[1] - a[1]).map(([emoji, k]) => <span key={emoji} className="reaction-chip">{emoji}{k > 1 ? ` ${k}` : ''}</span>)}</div> : null;
        })()}
        {m && <MessageExtras m={m} room={room} showChoices={showChoices} />}
        {n && (n.attachments?.length || n.imageUrl) ? <Pictures attachments={n.attachments} imageUrl={n.imageUrl} size={180} /> : null}
        {n && showChoices && n.choices && <Choices choices={n.choices} room={room} seq={n.seq} />}
        {n && workNoticeLabel(n.kind) && <HandoverButton m={n} />}
        {e.replies.length > 0 && (
          <div className="replies">
            {repliesOpen && e.replies.map((r) => <div key={r.seq} className="reply"><EntryView e={r} room={room} faces showChoices={false} onMenu={onMenu} compact /></div>)}
            <button className="reply-toggle" onClick={() => setRepliesOpen((o) => !o)} aria-expanded={repliesOpen}>
              {repliesOpen ? '답글 접기' : <><b>답글 {e.replies.length}개</b><span className="secondary"> {e.replies[e.replies.length - 1].speaker.name}: {previewText(e.replies[e.replies.length - 1].text, 50)}</span></>}
            </button>
          </div>
        )}
        {m && <Reactions m={m} pinned={m.seq === latest} />}
      </div>
    </div>
  );
}

/** "Leo·Mia·Victor의 대화 6개" — many lines folded into one; opens in place. */
function FoldedRun({ fold, room, open, toggle, onMenu }: { fold: Folded; room: string; open: boolean; toggle: () => void; onMenu: MenuOpener }) {
  const { session } = useApp();
  return (
    <div className="folded">
      <button className="folded-head" onClick={toggle} aria-expanded={open}>
        <span className="faces">{fold.names.slice(0, 3).map((n) => <BotAvatar key={n} name={n} size={20} ordinal={ordinalOf(session.bots, allBots(session.bots).find((b) => b.name === n)?.id ?? '')} />)}</span>
        <span className="bold" style={{ flex: 1, textAlign: 'left' }}>{fold.title}</span>
        <span className="accent">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && fold.entries.map((e) => <EntryView key={e.seq} e={{ ...e, showHeader: true }} room={room} faces showChoices={false} onMenu={onMenu} />)}
    </div>
  );
}

function MessageExtras({ m, room, showChoices }: { m: MessageEvent; room: string; showChoices: boolean }) {
  return (
    <>
      {(m.attachments?.length || m.imageUrl) ? <Pictures attachments={m.attachments} imageUrl={m.imageUrl} /> : null}
      {m.links?.filter((l) => l.url.startsWith('https://')).map((l) => (
        <a key={l.url} className="link" style={{ fontSize: 13 }} title={l.url} onClick={() => void openLink(l.url)}>{l.label}</a>
      ))}
      {showChoices && m.choices && <Choices choices={m.choices} room={room} seq={m.seq} />}
      <HandoverButton m={m} />
    </>
  );
}

/** §22: the assistant handed a browser page over (`live` field, or "앱의 브라우저 화면에서 직접 …" from older servers) → one button to that screen. */
function HandoverButton({ m }: { m: { text: string; live?: { view: string } } }) {
  const { session, go } = useApp();
  if (!hasFeature(session.capabilities, 'browser-live') || !handsOver(m)) return null;
  return <button className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => go({ section: 'browser-live' })}>브라우저 화면 열기</button>;
}

/** 👍 이런 거 더 / 👎 이런 거 덜 (feature `reactions`) and copy. Shown on hover; always on the newest bot message. */
function Reactions({ m, pinned }: { m: MessageEvent; pinned: boolean }) {
  const { session } = useApp();
  const on = hasFeature(session.capabilities, 'reactions');
  const mine = session.reactions.get(m.seq);
  return (
    <div className={`react-bar${pinned || mine ? ' pinned' : ''}`}>
      {on && <button className={`react-btn${mine === 'up' ? ' on' : ''}`} aria-pressed={mine === 'up'} title="좋아요 · 이런 거 더" aria-label="좋아요, 이런 거 더" onClick={() => void session.react(m.seq, 'up')}>{mine === 'up' ? <Icon.thumbUpFill /> : <Icon.thumbUp />}</button>}
      {on && <button className={`react-btn down${mine === 'down' ? ' on' : ''}`} aria-pressed={mine === 'down'} title="별로예요 · 이런 거 덜" aria-label="별로예요, 이런 거 덜" onClick={() => void session.react(m.seq, 'down')}>{mine === 'down' ? <Icon.thumbUpFill /> : <Icon.thumbUp />}</button>}
      <button className="react-btn" title="복사" aria-label="복사" onClick={() => void copyText(session, m.text)}><Icon.copy /></button>
    </div>
  );
}

async function copyText(session: ReturnType<typeof useApp>['session'], text: string) {
  try { await navigator.clipboard.writeText(text); session.say('복사했어요'); } catch { session.say('복사하지 못했어요'); }
}

/** Right-click on a bot message. */
function MessageMenu({ x, y, m, onDone }: { x: number; y: number; m: MessageEvent; onDone: () => void }) {
  const { session } = useApp();
  const on = hasFeature(session.capabilities, 'reactions');
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 130);
  return (
    <div className="ctx-menu" role="menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {on && <button role="menuitem" onClick={() => { onDone(); void session.react(m.seq, 'up'); }}>좋아요 · 이런 거 더</button>}
      {on && <button role="menuitem" onClick={() => { onDone(); void session.react(m.seq, 'down'); }}>별로예요 · 이런 거 덜</button>}
      <button role="menuitem" onClick={() => { onDone(); void copyText(session, m.text); }}>복사</button>
    </div>
  );
}

/** §3 `POST share`: photos and files to the assistant (12MB each). Used by the + button and drag-and-drop. */
export async function sendFiles(session: ReturnType<typeof useApp>['session'], files: File[]) {
  for (const file of files) {
    if (file.size > 12 * 1024 * 1024) { session.say(`${file.name}: 12MB보다 큰 파일은 보낼 수 없어요.`); continue; }
    try {
      await session.api.share(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
      session.say(`${file.name}을(를) 비서에게 보냈어요`);
      await session.catchUp();
    } catch (err) { session.say(err instanceof Error ? err.message : '보내지 못했어요'); }
  }
}

/** Attached pictures (§7.5): `files/<id>` fetched with the token in Rust, or a direct https `imageUrl`. Click = full size. */
export function Pictures({ attachments, imageUrl, size = 220 }: { attachments?: Attachment[]; imageUrl?: string; size?: number }) {
  const images = (attachments ?? []).filter((a) => a.contentType.startsWith('image/'));
  const others = (attachments ?? []).filter((a) => !a.contentType.startsWith('image/'));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {images.map((a) => <Picture key={a.id} src={a.url} type={a.contentType} name={a.name} size={size} />)}
      {imageUrl?.startsWith('https://') && <Picture src={imageUrl} name="그림" size={size} />}
      {others.map((a) => <FileRow key={a.id} file={a} />)}
    </div>
  );
}

/** §19: a document the assistant sent (pdf, office, hwp, txt, zip). Click = save to Downloads and preview. */
function FileRow({ file }: { file: Attachment }) {
  const { session } = useApp();
  const [state, setState] = useState<'idle' | 'busy' | 'gone'>('idle');
  const [saved, setSaved] = useState<SavedFile | null>(null);
  const open = async () => {
    if (saved) { void previewFile(saved.path); return; }
    setState('busy');
    try {
      const s = await saveFile(file.url, file.name);
      setSaved(s);
      setState('idle');
      void previewFile(s.path);
      session.say(`다운로드 폴더에 저장했어요: ${s.name}`);
    } catch (e) {
      if (String(e) === 'gone') setState('gone');
      else { setState('idle'); session.say(typeof e === 'string' ? e : '파일을 받지 못했어요.'); }
    }
  };
  const ext = (file.name.split('.').pop() ?? '').toUpperCase().slice(0, 4);
  return (
    <div className={`file-row${state === 'gone' ? ' gone' : ''}`}>
      <button className="file-main" onClick={() => void open()} disabled={state !== 'idle'} title={state === 'gone' ? '' : saved ? '미리 보기' : '받아서 미리 보기'}>
        <span className="file-badge">{ext || '파일'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{file.name}</span>
          <span className="footnote">{state === 'gone' ? '하루가 지나 맥에서 지워졌어요. 다시 보내 달라고 해 주세요.' : [fileSize(file.size), saved ? '받음 · 누르면 미리 보기' : '누르면 받아서 미리 보기'].filter(Boolean).join(' · ')}</span>
        </span>
        {state === 'busy' && <span className="spinner" />}
      </button>
      {saved?.path && <button className="btn plain small" onClick={() => void revealFile(saved.path)}>Finder에서 보기</button>}
    </div>
  );
}

function Picture({ src, type, name, size }: { src: string; type?: string; name: string; size: number }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [big, setBig] = useState(false);
  useEffect(() => { let live = true; setUrl(undefined); void fileUrl(src, type).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [src, type]);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  if (!url) return <div className="picture-wait" style={{ width: size, height: size * 0.75 }}>{url === undefined ? '그림 불러오는 중…' : '그림을 불러오지 못했어요'}</div>;
  return (
    <>
      <img className="attach-img" src={url} alt={name} style={{ maxWidth: size, maxHeight: size }} onClick={() => setBig(true)} title="크게 보기" />
      {big && <div className="lightbox" onClick={() => setBig(false)} role="dialog" aria-label={name}><img src={url} alt={name} /></div>}
    </>
  );
}

/** Choices under a line: once one is picked, all of them are done (a double click sends once). */
function Choices({ choices, room, seq }: { choices: Choice[]; room: string; seq: number }) {
  const { session } = useApp();
  const picked = choices.find((c) => session.chosen.has(`${seq}:${c.id}`));
  return (
    <div className="choices">
      {choices.map((c) => (
        <button key={c.id} className={`choice${picked?.id === c.id ? ' on' : ''}`} disabled={!!picked} aria-pressed={picked?.id === c.id}
          onClick={() => void session.choose(c, room, seq)}>{c.label}</button>
      ))}
    </div>
  );
}

function NoticeLine({ n, room, showChoices }: { n: NoticeEvent; room: string; showChoices: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div className="notice"><LongText text={cleanText(n.text)} lines={6} /></div>
      {showChoices && n.choices && <Choices choices={n.choices} room={room} seq={n.seq} />}
      <HandoverButton m={n} />
    </div>
  );
}

/** "개발 팀장에게 맡겼어요 ›" — opens that team's room. */
function DelegationLine({ d }: { d: DelegationEvent }) {
  const { openRoom } = useApp();
  const title = d.state === 'started' ? `${d.bot.name}에게 맡겼어요` : d.state === 'done' ? `${subject(d.bot.name)} 끝냈어요` : `${subject(d.bot.name)} 막혔어요`;
  return (
    <button className="line-card" onClick={() => openRoom(d.botChannel)} aria-label={`${title}. 방 열기`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={`t${d.state === 'failed' ? ' red' : ''}`}>{title}</div>
        <div className="x">{cleanText(d.summary ?? d.task)}</div>
      </div>
      <Icon.chevron />
    </button>
  );
}

/** A 결재 in the chat is one line; answering happens in the 결재 pane so the conversation stays readable. */
function CardLine({ card }: { card: CardEvent }) {
  const { session, go } = useApp();
  const open = session.timeline.isOpen(card.cardId);
  const closure = session.timeline.closure(card.cardId);
  return (
    <button className="line-card" style={{ opacity: open ? 1 : 0.7, cursor: open ? 'pointer' : 'default' }} onClick={() => { if (open) { session.selectedCard = card.cardId; go({ section: 'approvals' }); } }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t" style={{ color: open ? 'var(--accent)' : 'var(--text2)' }}>{open ? '결재 요청' : `결재 끝 · ${closedLabel(closure, !closure)}`}</div>
        {/* The context is a natural sentence or two (who, when, what, why): always shown whole, never cut. */}
        <div className="x full">{cardLine(card.summary, card.note)}</div>
      </div>
      {open && <Icon.chevron />}
    </button>
  );
}
