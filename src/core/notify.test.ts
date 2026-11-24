import { describe, expect, it } from 'vitest';
import type { AppEvent } from './events';
import { NoteLimiter, noteFor } from './notify';

const now = Date.parse('2026-11-19T09:00:00Z');
const at = new Date(now - 1000).toISOString();
const ctx = { assistantName: '비서', roomTitle: (r: string) => (r === 'dev' ? '개발팀' : r), now };

describe('noteFor', () => {
  it('always tells about a new 결재', () => {
    expect(noteFor({ type: 'card', seq: 1, at, cardId: 'c', summary: '어떻게 보낼까요?', effects: [], effectLabels: [], note: '견적서가 준비됐어요' }, ctx))
      .toEqual({ title: '결재: 어떻게 보낼까요?', body: '견적서가 준비됐어요', key: 'card:c' });
  });
  it('tells assistant messages but not bots talking to each other or meetings', () => {
    expect(noteFor({ type: 'message', seq: 2, at, role: 'assistant', text: '안녕' }, ctx)?.title).toBe('비서');
    expect(noteFor({ type: 'message', seq: 3, at, role: 'assistant', text: 'x', channel: 'dev', author: { id: 'dev', name: '개발 팀장' } }, ctx)?.title).toBe('개발 팀장');
    expect(noteFor({ type: 'message', seq: 4, at, role: 'assistant', text: 'x', channel: 'dev', author: { id: 'a', name: 'A' }, to: { id: 'b', name: 'B' } }, ctx)).toBeNull();
    expect(noteFor({ type: 'message', seq: 5, at, role: 'assistant', text: 'x', channel: 'meeting:hanbit' }, ctx)).toBeNull();
    expect(noteFor({ type: 'message', seq: 6, at, role: 'owner', text: 'me' }, ctx)).toBeNull();
    // §21.3 work-thread lines and bot talk written into a line stay quiet.
    expect(noteFor({ type: 'message', seq: 7, at, role: 'assistant', text: '테스트 중', channel: 'dev', author: { id: 'dev', name: '개발 팀장' }, thread: { id: 't1', title: '파서' } } as AppEvent, ctx)).toBeNull();
    expect(noteFor({ type: 'notice', seq: 8, at, text: '💬 레오 → 미아 · 질문: 이거 맞아요?' }, ctx)).toBeNull();
  });
  it('tells when a team finishes or gets stuck, not when it starts', () => {
    const d = { type: 'delegation', seq: 7, at, bot: { id: 'dev', name: '개발 팀장' }, botChannel: 'dev', task: '고치기' } as const;
    expect(noteFor({ ...d, state: 'started' } as AppEvent, ctx)).toBeNull();
    expect(noteFor({ ...d, state: 'failed' } as AppEvent, ctx)?.title).toBe('개발 팀장: 막혔어요');
  });
  it('never notifies about old events replayed after a reconnect', () => {
    expect(noteFor({ type: 'notice', seq: 8, at: new Date(now - 11 * 60_000).toISOString(), text: 'old' }, ctx)).toBeNull();
  });
});

describe('결재 context in notifications', () => {
  it('passes the whole note as written, without labels or cutting', () => {
    const note = '거래처 김대리님이 오늘 오전에 11월 납품 견적을 오늘 안에 보내 달라고 했어요. 견적서(1,240만원)는 문서에 준비돼 있어요.';
    const n = noteFor({ type: 'card', seq: 9, at, cardId: 'q', summary: '어떻게 보낼까요?', effects: ['send'], effectLabels: [], note }, ctx)!;
    expect(n.body).toBe(note);
    expect(n.body).not.toMatch(/누가:|언제:/);
  });
});

describe('NoteLimiter', () => {
  it('lets 3 through per minute and folds the rest into one line', () => {
    const l = new NoteLimiter(3, 60_000);
    const n = (i: number) => ({ title: 't', body: String(i), key: String(i) });
    expect(l.offer(n(1), 0)).toHaveLength(1);
    l.offer(n(2), 1); l.offer(n(3), 2);
    expect(l.offer(n(4), 3)).toEqual([]);
    expect(l.offer(n(5), 4)).toEqual([]);
    const later = l.offer(n(6), 61_000);
    expect(later.map((x) => x.body)).toEqual(['새 소식이 2개 더 있어요', '6']);
  });
});
