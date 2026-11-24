import { questionKey, roomOf, type AppEvent, type CardClosedEvent, type CardEvent, type DelegationEvent, type MessageEvent, type NoticeEvent } from './events';

// The ordered event log split into rooms ("" = the main chat). Pure logic with no I/O, so it is easy to test.
// Events arrive twice (stream + `events?after=` catch-up) and out of order; `apply` keeps one copy of each seq in order.

export type Item =
  | { kind: 'message'; seq: number; event: MessageEvent }
  | { kind: 'notice'; seq: number; event: NoticeEvent }
  /** Cards are looked up by id so a re-sent card (same id, new content — R15) replaces the old one in place. */
  | { kind: 'card'; seq: number; cardId: string }
  | { kind: 'delegation'; seq: number; event: DelegationEvent };

export const MAX_PER_ROOM = 1000;

export class Timeline {
  lastSeq = 0;
  private seen = new Set<number>();
  private rooms = new Map<string, Item[]>();
  readonly cards = new Map<string, CardEvent>();
  readonly closed = new Map<string, CardClosedEvent>();
  /** §21.4: reactions under a line (target seq → emoji → count). */
  readonly reactions = new Map<number, Map<string, number>>();
  /** Newest seq the owner has looked at, per room. */
  readonly readUpTo = new Map<string, number>();

  /** Returns true when the event was new. */
  apply(event: AppEvent): boolean {
    if (this.seen.has(event.seq)) return false;
    this.seen.add(event.seq);
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    const room = roomOf(event);
    switch (event.type) {
      case 'message': this.append({ kind: 'message', seq: event.seq, event }, room); break;
      case 'notice': this.append({ kind: 'notice', seq: event.seq, event }, room); break;
      case 'delegation': this.append({ kind: 'delegation', seq: event.seq, event }, room); break;
      case 'card': {
        const isNew = !this.cards.has(event.cardId);
        const older = this.cards.get(event.cardId);
        // A late catch-up copy must not replace a newer re-send of the same card.
        if (!older || older.seq <= event.seq) this.cards.set(event.cardId, event);
        if (isNew) this.append({ kind: 'card', seq: event.seq, cardId: event.cardId }, room);
        break;
      }
      case 'card_closed': this.closed.set(event.cardId, event); break;
      case 'reaction': {
        const counts = this.reactions.get(event.target) ?? new Map<string, number>();
        counts.set(event.emoji, (counts.get(event.emoji) ?? 0) + 1);
        this.reactions.set(event.target, counts);
        break;
      }
      case 'read': this.readUpTo.set(room, Math.max(this.readUpTo.get(room) ?? 0, event.upTo)); break;
      case 'unknown': break;
    }
    return true;
  }

  applyAll(events: AppEvent[]): number {
    let added = 0;
    for (const e of [...events].sort((a, b) => a.seq - b.seq)) if (this.apply(e)) added++;
    return added;
  }

  private append(item: Item, room: string) {
    const list = this.rooms.get(room) ?? [];
    const last = list[list.length - 1];
    if (last && last.seq > item.seq) {
      const index = list.findIndex((i) => i.seq > item.seq);
      list.splice(index, 0, item);
    } else {
      list.push(item);
    }
    if (list.length > MAX_PER_ROOM) list.splice(0, list.length - MAX_PER_ROOM);
    this.rooms.set(room, list);
  }

  items(room: string): readonly Item[] { return this.rooms.get(room) ?? []; }
  get roomIds(): string[] { return [...this.rooms.keys()]; }

  card(id: string) { return this.cards.get(id); }
  closure(id: string) { return this.closed.get(id); }

  isOpen(id: string, now = Date.now()): boolean {
    const card = this.cards.get(id);
    if (!card || this.closed.has(id)) return false;
    if (card.expiresAt && Date.parse(card.expiresAt) < now) return false;
    return true;
  }

  /** Open cards, newest first. The same question never shows twice: older open cards with the same key are hidden. */
  openCards(now = Date.now()): CardEvent[] {
    const keys = new Set<string>();
    return [...this.cards.values()]
      .filter((c) => this.isOpen(c.cardId, now))
      .sort((a, b) => b.seq - a.seq)
      .filter((c) => {
        const k = questionKey(c);
        if (keys.has(k)) return false;
        keys.add(k);
        return true;
      });
  }

  /** An older copy of a question that is asked again in a newer open card (hidden in lists and the chat). */
  isDuplicate(id: string, now = Date.now()): boolean {
    const card = this.cards.get(id);
    if (!card || !this.isOpen(id, now)) return false;
    return !this.openCards(now).some((c) => c.cardId === id);
  }

  /** Closed (or expired) cards, newest first. */
  finishedCards(now = Date.now(), limit = 20): CardEvent[] {
    return [...this.cards.values()].filter((c) => !this.isOpen(c.cardId, now)).sort((a, b) => b.seq - a.seq).slice(0, limit);
  }

  /** After the owner answers, before `card_closed` arrives on the stream (or when the stream is down). */
  closeLocally(cardId: string, state: string, answer?: string) {
    const card = this.cards.get(cardId);
    if (this.closed.has(cardId) || !card) return;
    this.closed.set(cardId, { type: 'card_closed', seq: 0, at: new Date().toISOString(), cardId, state, answer, channel: card.channel });
  }

  markRead(room: string) {
    const items = this.items(room);
    const last = items[items.length - 1]?.seq;
    this.readUpTo.set(room, last ?? this.readUpTo.get(room) ?? 0);
  }

  unreadCount(room: string): number {
    const after = this.readUpTo.get(room) ?? 0;
    return this.items(room).filter((i) => i.seq > after && (i.kind !== 'message' || i.event.role === 'assistant')).length;
  }

  /** Short line for the bot list. */
  preview(room: string): { text: string; at: string } | null {
    const items = this.items(room);
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      switch (it.kind) {
        case 'message': case 'notice': return { text: it.event.text, at: it.event.at };
        case 'delegation': return { text: it.event.task, at: it.event.at };
        case 'card': { const c = this.cards.get(it.cardId); if (c) return { text: c.summary, at: c.at }; }
      }
    }
    return null;
  }
}
