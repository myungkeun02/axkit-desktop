import { noticeIsBubble } from './chatChoices';
import { cleanText, parseBotTalk, type BotTalk } from './chatText';
import type { Author } from './events';
import { dayLine } from './format';
import type { Item } from './timeline';
import { workNoticeLabel } from './work';

// A room laid out like a group chat: who said it, consecutive lines from one speaker grouped, day separators,
// replies folded under what they answer, long runs of bot-to-bot talk or work logs folded into one line.
// Same rules as the iPhone app (AxKitCore/RoomFeed.swift).

export interface Speaker { id: string; name: string; avatar?: string; isOwner?: boolean }
export const OWNER: Speaker = { id: 'owner', name: '나', isOwner: true };

export interface Entry {
  seq: number;
  at: string;
  speaker: Speaker;
  to?: string;
  label?: string;
  text: string;
  isStatus: boolean;
  isReply: boolean;
  showHeader: boolean;
  repeats: number;
  replies: Entry[];
  item: Item;
  /** §21.3: the work thread this line belongs to, and its title. */
  thread?: string;
  threadTitle?: string;
}

export interface Folded { id: string; title: string; names: string[]; entries: Entry[] }

export type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'entry'; key: string; entry: Entry }
  | { kind: 'folded'; key: string; fold: Folded }
  | { kind: 'system'; key: string; item: Item };

type Unit = { kind: 'entry'; entry: Entry } | { kind: 'system'; item: Item };

const sameSpeaker = (a: Speaker, b: Speaker) => a.id === b.id && a.name === b.name;

function entry(item: Item, at: string, speaker: Speaker, text: string, extra: Partial<Entry> = {}): Entry {
  const t = item.kind === 'message' || item.kind === 'notice' ? item.event.thread : undefined;
  return { seq: item.seq, at, speaker, text: cleanText(text), isStatus: false, isReply: false, showHeader: true, repeats: 1, replies: [], item,
    thread: t?.id, threadTitle: t?.title, ...extra };
}

function talkEntry(item: Item, at: string, t: BotTalk): Entry {
  return entry(item, at, { id: `bot:${t.from}`, name: t.from }, t.text, { to: t.to, label: t.label, isReply: t.isReply });
}

const hasMedia = (item: Item) =>
  (item.kind === 'message' || item.kind === 'notice') && (!!item.event.attachments?.length || !!item.event.imageUrl);

export interface FeedOptions {
  /** Who speaks for the room when a line has no author (the team lead). */
  lead?: Speaker | null;
  assistant: string;
  cardDate?: (cardId: string) => string | undefined;
  now?: number;
  foldAt?: number;
}

export function buildFeed(items: readonly Item[], room: string, o: FeedOptions): Row[] {
  const now = o.now ?? Date.now();
  const foldAt = o.foldAt ?? 4;
  const roomVoice: Speaker = o.lead ?? { id: room || 'assistant', name: o.assistant };
  const botSpeaker = (a?: Author): Speaker => a ? { id: a.id, name: a.name, avatar: a.avatar } : room ? roomVoice : { id: 'assistant', name: o.assistant };

  // 1. items → entries / system rows
  const units: Unit[] = [];
  for (const item of items) {
    if (item.kind === 'message') {
      const m = item.event;
      const talk = !m.author && m.role !== 'owner' ? parseBotTalk(m.text) : null;
      if (m.role === 'owner') units.push({ kind: 'entry', entry: entry(item, m.at, OWNER, m.text) });
      else if (talk) units.push({ kind: 'entry', entry: talkEntry(item, m.at, talk) });
      else units.push({ kind: 'entry', entry: entry(item, m.at, botSpeaker(m.author), m.text, { to: m.to?.name }) });
    } else if (item.kind === 'notice') {
      const n = item.event;
      const talk = parseBotTalk(n.text);
      const work = workNoticeLabel(n.kind);
      // §28: a long task's result is the assistant answering, later — a bubble with a small label, not a grey line.
      if (work && !talk) units.push({ kind: 'entry', entry: entry(item, n.at, n.author ? botSpeaker(n.author) : room ? roomVoice : { id: 'assistant', name: o.assistant }, n.text, { label: work }) });
      else if (talk) units.push({ kind: 'entry', entry: talkEntry(item, n.at, talk) });
      else if (n.author) units.push({ kind: 'entry', entry: entry(item, n.at, botSpeaker(n.author), n.text) });
      else if (room) units.push({ kind: 'entry', entry: entry(item, n.at, roomVoice, n.text, { isStatus: true }) });
      // The assistant asking something (buttons) or saying more than a line: its own bubble, like any answer.
      else if (noticeIsBubble(n)) units.push({ kind: 'entry', entry: entry(item, n.at, { id: 'assistant', name: o.assistant }, n.text) });
      else units.push({ kind: 'system', item });
    } else {
      units.push({ kind: 'system', item });
    }
  }

  // 2. replies fold under the line they answer
  const merged: Unit[] = [];
  const threadRoot = new Map<string, Entry>();
  for (const u of units) {
    if (u.kind === 'entry' && u.entry.thread) {
      const root = threadRoot.get(u.entry.thread);
      if (root) root.replies.push(u.entry);
      else { threadRoot.set(u.entry.thread, u.entry); merged.push(u); }
      continue;
    }
    if (u.kind !== 'entry' || !u.entry.isReply || !u.entry.to) { merged.push(u); continue; }
    const e = u.entry;
    let target = -1;
    for (let i = merged.length - 1; i >= 0 && i >= merged.length - 40; i--) {
      const r = merged[i];
      if (r.kind === 'entry' && r.entry.speaker.name === e.to && r.entry.to === e.speaker.name && !r.entry.isReply) { target = i; break; }
    }
    if (target >= 0) (merged[target] as { entry: Entry }).entry.replies.push(e);
    else merged.push(u);
  }

  // 3. the same line again right after → ×2; lines cleaned to nothing disappear
  const deduped: Unit[] = [];
  for (const u of merged) {
    if (u.kind === 'entry') {
      if (!u.entry.text && !hasMedia(u.entry.item)) continue;
      const last = deduped[deduped.length - 1];
      if (last?.kind === 'entry' && sameSpeaker(last.entry.speaker, u.entry.speaker) && last.entry.text === u.entry.text && !u.entry.replies.length) {
        last.entry.repeats++;
        continue;
      }
    }
    deduped.push(u);
  }

  // 4. long runs of work logs or bot talk fold, keeping the newest two
  type Piece = Unit | { kind: 'folded'; fold: Folded };
  const pieces: Piece[] = [];
  let run: Entry[] = [];
  // 1 = work log, 2 = bot-to-bot talk, 3 = many lines in a row from one bot (a team lead's progress, §21.1)
  let runKind: 1 | 2 | 3 | 0 = 0;
  let runSpeaker: Speaker | null = null;
  const kindOf = (e: Entry): 1 | 2 | 3 | 0 => (e.isStatus ? 1 : e.to && !e.speaker.isOwner ? 2 : room && !e.speaker.isOwner && !e.replies.length ? 3 : 0);
  const flush = () => {
    if (run.length >= (runKind === 3 ? foldAt + 2 : foldAt)) {
      const hidden = run.slice(0, -2);
      const names: string[] = [];
      for (const e of hidden) for (const n of [e.speaker.name, ...(e.to ? [e.to] : [])]) if (!names.includes(n)) names.push(n);
      const replies = hidden.reduce((s, e) => s + e.replies.length, 0);
      const title = runKind === 1
        ? `이전 작업 기록 ${hidden.length}개`
        : runKind === 3 ? `${hidden[0].speaker.name}의 이전 글 ${hidden.length}개`
        : `${names.slice(0, 3).join('·')}${names.length > 3 ? ` 외 ${names.length - 3}명` : ''}의 대화 ${hidden.length + replies}개`;
      pieces.push({ kind: 'folded', fold: { id: `f-${hidden[0].seq}`, title, names, entries: hidden } });
      for (const e of run.slice(-2)) pieces.push({ kind: 'entry', entry: e });
    } else {
      for (const e of run) pieces.push({ kind: 'entry', entry: e });
    }
    run = [];
    runKind = 0;
  };
  for (const u of deduped) {
    const k = u.kind === 'entry' ? kindOf(u.entry) : 0;
    if (u.kind === 'entry' && k) {
      if (runKind !== k || (k === 3 && runSpeaker && !sameSpeaker(runSpeaker, u.entry.speaker))) { flush(); runKind = k; runSpeaker = u.entry.speaker; }
      run.push(u.entry);
    } else {
      flush();
      pieces.push(u);
    }
  }
  flush();

  // 5. day lines and faces
  const rows: Row[] = [];
  let lastDay = '';
  let lastEntry: Entry | null = null;
  let lastAt: string | undefined;
  for (const p of pieces) {
    const at = p.kind === 'folded' ? p.fold.entries[0].at
      : p.kind === 'entry' ? p.entry.at
      : p.item.kind === 'card' ? (o.cardDate?.(p.item.cardId) ?? lastAt) : p.item.kind === 'message' || p.item.kind === 'notice' || p.item.kind === 'delegation' ? p.item.event.at : lastAt;
    const when = at ?? new Date(now).toISOString();
    lastAt = when;
    const day = dayLine(when, now);
    if (day !== lastDay) { rows.push({ kind: 'day', key: `d-${day}-${rows.length}`, label: day }); lastDay = day; lastEntry = null; }
    if (p.kind === 'folded') { rows.push({ kind: 'folded', key: p.fold.id, fold: p.fold }); lastEntry = null; }
    else if (p.kind === 'system') { rows.push({ kind: 'system', key: `s-${p.item.seq}`, item: p.item }); lastEntry = null; }
    else {
      const e = p.entry;
      if (lastEntry && sameSpeaker(lastEntry.speaker, e.speaker) && lastEntry.to === e.to && Date.parse(e.at) - Date.parse(lastEntry.at) < 600_000) e.showHeader = false;
      rows.push({ kind: 'entry', key: `e-${e.seq}`, entry: e });
      lastEntry = e;
    }
  }
  return rows;
}

/** The last line of a room for a list: "Leo: …", "Leo → Mia: …", "나: …". */
export function roomPreview(items: readonly Item[], room: string, assistant: string, card: (id: string) => { summary: string; note?: string; at: string } | undefined,
  preview: (t: string, n?: number) => string, title: (s: string, n?: string) => string): { text: string; at: string } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'message') {
      const m = item.event;
      const who = m.role === 'owner' ? '나' : m.author?.name ?? (room ? undefined : assistant);
      const t = preview(m.text, 90);
      if (!t) continue;
      return { text: who ? `${who}: ${t}` : t, at: m.at };
    }
    if (item.kind === 'notice') {
      const talk = parseBotTalk(item.event.text);
      if (talk) return { text: `${talk.from} → ${talk.to}: ${preview(talk.text, 90)}`, at: item.event.at };
      const t = preview(item.event.text, 90);
      if (!t) continue;
      return { text: item.event.author ? `${item.event.author.name}: ${t}` : t, at: item.event.at };
    }
    if (item.kind === 'delegation') return { text: preview(item.event.summary ?? item.event.task, 90), at: item.event.at };
    const c = card(item.cardId);
    if (c) return { text: `결재: ${preview(title(c.summary, c.note), 80)}`, at: c.at };
  }
  return null;
}
