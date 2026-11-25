import { describe, expect, it } from 'vitest';
import { answeredOption, cardEcho, liveChoicesSeq, noticeIsBubble } from './chatChoices';
import type { CardEvent, MessageEvent, NoticeEvent } from './events';
import type { Item } from './timeline';

const at = '2026-11-25T09:00:00Z';
const notice = (seq: number, text: string, choices?: { id: string; label: string }[]): Item =>
  ({ kind: 'notice', seq, event: { type: 'notice', seq, at, text, choices } as NoticeEvent });
const msg = (seq: number, role: 'owner' | 'assistant', text: string, choices?: { id: string; label: string }[]): Item =>
  ({ kind: 'message', seq, event: { type: 'message', seq, at, role, text, choices } as MessageEvent });
const card: CardEvent = {
  type: 'card', seq: 1, at, cardId: 'c1', summary: '보낼까요?', effects: ['send'], effectLabels: [],
  options: [{ id: 'yes', label: '네, 보내요', tone: 'primary' }, { id: 'later', label: '내일 보내요', tone: 'neutral' }, { id: 'no', label: '아니요', tone: 'danger' }],
};

describe('buttons in the chat', () => {
  it('makes asking or long notices a bubble, one-liners stay a grey line', () => {
    expect(noticeIsBubble({ text: '답을 기다리는 메일이 2통 있어요.', choices: [{ id: 'a' }] })).toBe(true);
    expect(noticeIsBubble({ text: '1) 김민수님 — 견적\n2) 이수진님 — 일정' })).toBe(true);
    expect(noticeIsBubble({ text: '연결됐어요.' })).toBe(false);
  });
  it('keeps only the latest buttons live, until the owner answers', () => {
    const two = [{ id: 'a', label: '1번' }];
    expect(liveChoicesSeq([notice(1, 'x', two), notice(2, 'y', two), msg(3, 'assistant', '참고로…')])).toBe(2);
    expect(liveChoicesSeq([notice(1, 'x', two), msg(2, 'owner', '1번 김민수님께 답장 쓰기')])).toBeNull();
    expect(liveChoicesSeq([msg(1, 'assistant', '안녕하세요')])).toBeNull();
  });
  it('turns a card answer into the owner line and marks the button', () => {
    expect(cardEcho(card, { type: 'card_closed', seq: 2, at, cardId: 'c1', state: 'closed', answer: '내일 보내요' })).toBe('내일 보내요');
    expect(cardEcho(card, { type: 'card_closed', seq: 2, at, cardId: 'c1', state: 'approved' })).toBe('네, 보내요');
    expect(cardEcho(card, { type: 'card_closed', seq: 2, at, cardId: 'c1', state: 'denied' })).toBe('아니요');
    expect(cardEcho(card, { type: 'card_closed', seq: 2, at, cardId: 'c1', state: 'expired' })).toBeNull();
    expect(cardEcho(card, undefined)).toBeNull();
    expect(answeredOption(card, { type: 'card_closed', seq: 2, at, cardId: 'c1', state: 'closed', answer: '내일 보내요' })).toBe('later');
    expect(answeredOption(card, { type: 'card_closed', seq: 2, at, cardId: 'c1', state: 'closed', answer: '직접 쓴 답' })).toBeNull();
  });
});
