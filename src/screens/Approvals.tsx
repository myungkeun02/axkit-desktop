import { cardTitle, cleanText } from '../core/chatText';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { hasView } from '../core/api';
import { closedLabel, opensInApp, optionsFor } from '../core/cards';
import type { CardEvent, CardOption } from '../core/events';
import { clock, relative } from '../core/format';
import { allBots } from '../core/views';
import { BotAvatar } from '../ui/BotAvatar';
import { Check, Empty, Icon, Segmented } from '../ui/kit';
import { Banners } from './Banners';
import { ordinalOf, Pictures } from './Chat';
import { AutonomyScreen } from './Sections';

/** 결재: a list on the left, the chosen question on the right. ↑↓ moves, 1–9 picks a choice. */
export function Approvals() {
  const { session } = useApp();
  const [view, setView] = useState<'open' | 'done' | 'auto'>('open');
  const open = session.timeline.openCards();
  const done = session.timeline.finishedCards(Date.now(), 50);
  const list = view === 'open' ? open : view === 'done' ? done : [];
  const [selected, setSelected] = useState<string | null>(session.selectedCard);
  const current = list.find((c) => c.cardId === selected) ?? list[0];

  useEffect(() => { if (session.selectedCard) { setView('open'); setSelected(session.selectedCard); session.selectedCard = null; } }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const i = list.findIndex((c) => c.cardId === current?.cardId);
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setSelected(list[Math.min(i + 1, list.length - 1)]?.cardId ?? null); }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setSelected(list[Math.max(i - 1, 0)]?.cardId ?? null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, current]);

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>결재</h1>
        <div className="side right" />
      </header>
      <Banners />
      <div className="split">
        <div className="split-list">
          <div style={{ padding: '12px 12px 8px' }}>
            <Segmented value={view} onChange={setView} options={[
              { id: 'open', label: `기다리는 것 ${open.length}` }, { id: 'done', label: '지난 것' },
              ...(hasView(session.capabilities, 'autonomy') ? [{ id: 'auto' as const, label: '자동 승인' }] : []),
            ]} />
          </div>
          {view !== 'auto' && (
            <div className="scroll" role="listbox" aria-label="결재 목록">
              {list.length === 0 && <div className="secondary" style={{ padding: 20 }}>{view === 'open' ? '지금은 결재할 게 없어요.' : '지난 결재가 없어요.'}</div>}
              {list.map((c) => <CardRow key={c.cardId} card={c} selected={c.cardId === current?.cardId} onSelect={() => setSelected(c.cardId)} />)}
            </div>
          )}
          {view === 'auto' && <div className="secondary small" style={{ padding: '4px 16px' }}>묻지 않고 알아서 하는 일이에요. 오른쪽에서 그만둘 수 있어요.</div>}
        </div>
        <div className="split-detail scroll">
          <div className="page">
            {view === 'auto' ? <AutonomyScreen embedded /> : current ? (
              <>
                <CardPanel key={current.cardId + ':' + current.seq} card={current} keyboard />
                {view === 'open' && <div className="footnote" style={{ textAlign: 'center' }}>숫자 키로 고르고, ↑↓로 다른 결재로 옮겨요.</div>}
              </>
            ) : (
              <Empty icon={Icon.seal} title="지금은 결재할 게 없어요" message={'비서나 팀이 "이거 어떻게 할까요?" 하고 물어보면 여기에 올라와요.'} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function CardRow({ card, selected, onSelect }: { card: CardEvent; selected: boolean; onSelect: () => void }) {
  const { session } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const who = card.author?.name ?? session.assistantName;
  const bot = allBots(session.bots).find((b) => b.id === card.author?.id);
  const isOpen = session.timeline.isOpen(card.cardId);
  return (
    <button ref={ref} role="option" aria-selected={selected} className={`list-row${selected ? ' on' : ''}`} onClick={onSelect}>
      <BotAvatar name={who} size={32} avatar={bot?.avatar} ordinal={ordinalOf(session.bots, card.author?.id ?? '')} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span className="bold ellipsis" style={{ flex: 1 }}>{cardTitle(card.summary, card.note)}</span>
          <span className="footnote" style={{ flex: 'none' }}>{relative(card.at)}</span>
        </div>
        <div className="footnote card-note">{isOpen ? (card.note ? cleanText(card.note) : who) : closedLabel(session.timeline.closure(card.cardId), !session.timeline.closure(card.cardId))}</div>
      </div>
    </button>
  );
}

/** One 결재: context → short question → pictures → choices (one per line) → "앞으로는 알아서" → text box (always there). */
export function CardPanel({ card, compact, keyboard }: { card: CardEvent; compact?: boolean; keyboard?: boolean }) {
  const { session, go } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [remember, setRemember] = useState(false);
  const isOpen = session.timeline.isOpen(card.cardId);
  const closure = session.timeline.closure(card.cardId);
  const options = optionsFor(card);
  const canWrite = card.freeText !== false;
  const trimmed = text.trim();

  const choose = async (o: CardOption) => {
    if (busy) return;
    // "앱에서 고칠게요": open that screen; the card stays open and nothing is sent.
    const screen = opensInApp(card, o);
    if (screen) { go({ section: screen }); return; }
    setBusy(o.id);
    await session.answerOption(card, o, remember);
    setBusy(null);
  };
  const write = async () => {
    if (!trimmed || busy) return;
    setBusy('text');
    const ok = await session.answer(card, { text: trimmed.slice(0, 4000) });
    setBusy(null);
    if (ok) setText('');
  };

  useEffect(() => {
    if (!keyboard || !isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) { e.preventDefault(); void choose(options[n - 1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const kind = (o: CardOption) => (o.tone === 'primary' ? 'primary' : o.tone === 'danger' ? 'danger' : 'secondary');
  const who = card.author?.name;

  return (
    <div className={`panel approval${compact ? ' compact tight' : ''}${isOpen ? '' : ' closed'}`}>
      {!compact && (who || card.expiresAt) && (
        <div className="footnote">{[who, `${clock(card.at)}에 물어봄`].filter(Boolean).join(' · ')}</div>
      )}
      {/* Context is never cut; only leftovers (metadata lines, prompt blocks, Discord marks) are cleaned away. */}
      {card.note && cleanText(card.note) && cleanText(card.note) !== cardTitle(card.summary, card.note) && <div className="context selectable">{cleanText(card.note)}</div>}
      <div className="question selectable">{cardTitle(card.summary, card.note)}</div>
      {(card.attachments?.length || card.imageUrl) ? <Pictures attachments={card.attachments} imageUrl={card.imageUrl} size={compact ? 140 : 260} /> : null}
      {isOpen ? (
        <div className="answers">
          {options.map((o, i) => (
            <button key={o.id} className={`btn full ${kind(o)}`} disabled={busy !== null} onClick={() => void choose(o)} title={o.detail}>
              {keyboard && <span className="key-hint">{i + 1}</span>}
              <span style={{ flex: 1 }}>{o.label}</span>
              {busy === o.id && <span className="spinner" />}
            </button>
          ))}
          {card.remember && (
            <div style={{ marginTop: 2 }}>
              <Check on={remember} onChange={setRemember}>{card.remember.label}</Check>
              {card.remember.detail && <div className="footnote" style={{ marginLeft: 30 }}>{card.remember.detail}</div>}
            </div>
          )}
          {canWrite && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
              <textarea className="field" rows={1} placeholder="다른 지시를 직접 써 주세요" value={text} aria-label="다른 지시"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void write(); } }} />
              <button className="send-btn" disabled={!trimmed || busy !== null} onClick={() => void write()} aria-label="이 답 보내기">
                {busy === 'text' ? <span className="spinner" /> : <Icon.up />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="footnote bold" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ background: closure?.state === 'denied' ? 'var(--red)' : 'var(--green)' }} />
          {closedLabel(closure, !closure)}
        </div>
      )}
    </div>
  );
}
