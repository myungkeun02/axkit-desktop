import { describe, expect, it } from 'vitest';
import type { AppEvent, CardEvent } from './events';
import { MAX_PER_ROOM, Timeline } from './timeline';

const msg = (seq: number, text = `m${seq}`, extra: Partial<AppEvent> = {}): AppEvent =>
  ({ type: 'message', seq, at: new Date(seq * 1000).toISOString(), role: 'assistant', text, ...extra }) as AppEvent;
const card = (seq: number, cardId: string, extra: Partial<CardEvent> = {}): CardEvent =>
  ({ type: 'card', seq, at: new Date(seq * 1000).toISOString(), cardId, summary: `q-${cardId}`, effects: [], effectLabels: [], ...extra });

describe('Timeline', () => {
  it('keeps one copy of each seq (stream + catch-up deliver the same events)', () => {
    const t = new Timeline();
    expect(t.apply(msg(1))).toBe(true);
    expect(t.apply(msg(1))).toBe(false);
    expect(t.applyAll([msg(2), msg(1), msg(3)])).toBe(2);
    expect(t.items('').map((i) => i.seq)).toEqual([1, 2, 3]);
    expect(t.lastSeq).toBe(3);
  });

  it('puts late events in order', () => {
    const t = new Timeline();
    t.apply(msg(5));
    t.apply(msg(2));
    t.apply(msg(9));
    t.apply(msg(7));
    expect(t.items('').map((i) => i.seq)).toEqual([2, 5, 7, 9]);
  });

  it('splits rooms by channel', () => {
    const t = new Timeline();
    t.apply(msg(1));
    t.apply(msg(2, 'dev says', { channel: 'dev' }));
    expect(t.items('')).toHaveLength(1);
    expect(t.items('dev')).toHaveLength(1);
    expect(t.preview('dev')?.text).toBe('dev says');
  });

  it('replaces a re-sent card in place (R15) and closes it on card_closed', () => {
    const t = new Timeline();
    t.apply(card(1, 'c', { summary: 'old' }));
    t.apply(card(4, 'c', { summary: 'new' }));
    expect(t.items('')).toHaveLength(1);
    expect(t.card('c')?.summary).toBe('new');
    t.apply(card(1, 'c', { summary: 'old' })); // a late duplicate never wins
    expect(t.card('c')?.summary).toBe('new');
    expect(t.isOpen('c')).toBe(true);
    t.apply({ type: 'card_closed', seq: 5, at: '', cardId: 'c', state: 'approved' });
    expect(t.isOpen('c')).toBe(false);
    expect(t.finishedCards().map((c) => c.cardId)).toEqual(['c']);
  });

  it('shows the same question only once (R15)', () => {
    const t = new Timeline();
    t.apply(card(1, 'a', { topic: 'drive:save' }));
    t.apply(card(2, 'b', { topic: 'drive:save' }));
    t.apply(card(3, 'c', { note: 'n', summary: 'same?' }));
    t.apply(card(4, 'd', { note: 'n', summary: 'same?' }));
    t.apply(card(5, 'e'));
    expect(t.openCards().map((c) => c.cardId)).toEqual(['e', 'd', 'b']);
    expect(t.isDuplicate('a')).toBe(true);
    expect(t.isDuplicate('b')).toBe(false);
  });

  it('hides expired cards from the open list', () => {
    const t = new Timeline();
    t.apply(card(1, 'old', { expiresAt: new Date(1000).toISOString() }));
    t.apply(card(2, 'fresh', { expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(t.openCards().map((c) => c.cardId)).toEqual(['fresh']);
  });

  it('closes locally before the stream says so, without overriding the server', () => {
    const t = new Timeline();
    t.apply(card(1, 'c'));
    t.closeLocally('c', 'approved', '좋아요');
    expect(t.closure('c')?.answer).toBe('좋아요');
    t.closeLocally('c', 'denied');
    expect(t.closure('c')?.state).toBe('approved');
  });

  it('counts unread assistant lines per room', () => {
    const t = new Timeline();
    t.apply(msg(1, 'a', { channel: 'dev' }));
    t.apply({ type: 'message', seq: 2, at: '', role: 'owner', text: 'me', channel: 'dev' });
    t.apply(msg(3, 'b', { channel: 'dev' }));
    expect(t.unreadCount('dev')).toBe(2);
    t.markRead('dev');
    expect(t.unreadCount('dev')).toBe(0);
    t.apply(msg(4, 'c', { channel: 'dev' }));
    expect(t.unreadCount('dev')).toBe(1);
  });

  it('caps each room', () => {
    const t = new Timeline();
    for (let i = 1; i <= MAX_PER_ROOM + 5; i++) t.apply(msg(i));
    expect(t.items('')).toHaveLength(MAX_PER_ROOM);
    expect(t.items('')[0].seq).toBe(6);
  });

  it('ignores unknown events but remembers their seq', () => {
    const t = new Timeline();
    expect(t.apply({ type: 'unknown', rawType: 'x', seq: 8, at: '' })).toBe(true);
    expect(t.lastSeq).toBe(8);
    expect(t.items('')).toHaveLength(0);
  });
});
