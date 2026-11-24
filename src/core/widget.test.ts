import { describe, expect, it } from 'vitest';
import { ActivityBoard } from './activity';
import type { AppEvent } from './events';
import { Timeline } from './timeline';
import { busyLine, nextEvents, plainLine, recentNotes, todoLines, waitingCards } from './widget';

const now = Date.parse('2026-11-23T05:00:00Z'); // 14:00 in Seoul

describe('widget', () => {
  it('shows what is left of today', () => {
    const today = {
      date: '2026-11-23',
      events: [
        { title: '아침 회의', start: '2026-11-23T00:00:00Z', end: '2026-11-23T01:00:00Z' },
        { title: '시안 리뷰', start: '2026-11-23T07:00:00Z' },
        { title: '진행 중', start: '2026-11-23T04:30:00Z', end: '2026-11-23T05:30:00Z' },
        { title: '휴가', start: '2026-11-23', allDay: true },
        { title: '저녁', start: '2026-11-23T10:00:00Z' },
        { title: '늦은 통화', start: '2026-11-23T12:00:00Z' },
      ],
      todos: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    };
    const e = nextEvents(today, now);
    expect(e.items.map((x) => x.title)).toEqual(['휴가', '진행 중', '시안 리뷰']);
    expect(e.more).toBe(2);
    expect(todoLines(today)).toMatchObject({ items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], more: 1 });
    expect(nextEvents(null).items).toEqual([]);
    expect(nextEvents({ date: '', events: null, todos: null }).items).toEqual([]);
  });

  it('keeps notes plain and short', () => {
    expect(plainLine('**원두**가  [떨어져요](https://x.y)\n## `주문`할까요?')).toBe('원두가 떨어져요 주문할까요?');
    expect(plainLine('가'.repeat(100), 90)).toHaveLength(91);
  });

  it('picks the newest notices from every room', () => {
    const t = new Timeline();
    const ev = (seq: number, type: 'notice' | 'message', text: string, channel?: string) =>
      ({ seq, at: '2026-11-23T05:00:00Z', type, text, channel, ...(type === 'message' ? { role: 'assistant' } : {}) }) as AppEvent;
    t.applyAll([ev(1, 'notice', '첫 알림'), ev(2, 'notice', '디자인팀 알림', 'design'), ev(3, 'message', '그냥 답'), ev(4, 'notice', '  '), ev(5, 'notice', '새 알림')]);
    expect(recentNotes(t).map((n) => [n.seq, n.room, n.text])).toEqual([[5, '', '새 알림'], [2, 'design', '디자인팀 알림']]);
  });

  it('says who is busy', () => {
    const b = new ActivityBoard();
    const title = (r: string) => (r === 'design' ? '디자인팀' : r);
    expect(busyLine(b, title, '비서', now)).toBeNull();
    b.apply({ room: '', state: 'thinking', at: now - 1000 }, now);
    expect(busyLine(b, title, '비서', now)).toBe('비서가 생각하는 중');
    b.apply({ room: 'design', state: 'working', step: '메일 보는 중…', at: now }, now);
    expect(busyLine(b, title, '루미', now)).toBe('디자인팀 · 메일 보는 중 외 1곳');
    expect(busyLine(b, title, '루미', now + 4 * 60_000)).toBeNull();
  });

  it('counts waiting 결재 from the log once it has loaded', () => {
    const t = new Timeline();
    expect(waitingCards(t, { date: '', events: null, todos: null, pendingCards: 2 })).toBe(2);
    t.apply({ seq: 1, at: '2026-11-23T05:00:00Z', type: 'card', cardId: 'c1', summary: '결제', effects: [], effectLabels: [] } as AppEvent);
    expect(waitingCards(t, { date: '', events: null, todos: null, pendingCards: 9 })).toBe(1);
  });
});
