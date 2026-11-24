import { describe, expect, it } from 'vitest';
import { decodeEvent, decodeEventText, questionKey, roomOf, type CardEvent } from './events';

describe('decodeEvent', () => {
  it('reads every known type', () => {
    expect(decodeEvent({ type: 'message', seq: 1, at: 'x', role: 'assistant', text: 'hi', choices: [{ id: 'a', label: 'A' }], channel: 'dev', author: { id: 'dev', name: '개발 봇' } }))
      .toMatchObject({ type: 'message', role: 'assistant', channel: 'dev', author: { name: '개발 봇' }, choices: [{ id: 'a' }] });
    expect(decodeEvent({ type: 'message', seq: 9, at: 'x', role: 'assistant', text: '로그인에서 멈췄어요', live: { view: 'browser-live', reason: 'login', url: 'https://shop.example.com/login' } }))
      .toMatchObject({ live: { view: 'browser-live', reason: 'login', url: 'https://shop.example.com/login' } });
    expect((decodeEvent({ type: 'message', seq: 10, at: 'x', role: 'assistant', text: 't', live: 'yes' }) as { live?: unknown }).live).toBeUndefined();
    expect(decodeEvent({ type: 'notice', seq: 2, at: 'x', text: 'n' })).toMatchObject({ type: 'notice', text: 'n' });
    expect(decodeEvent({ type: 'card', seq: 3, at: 'x', cardId: 'c', summary: 'q?', effects: ['pay'], effectLabels: ['결제'], topic: 't', remember: { label: 'L' },
      options: [{ id: 'o', label: 'O', tone: 'primary' }, { id: 'p', label: 'P', tone: 'weird' }] }))
      .toMatchObject({ type: 'card', topic: 't', remember: { label: 'L' }, options: [{ id: 'o', tone: 'primary' }, { id: 'p', tone: undefined }] });
    expect(decodeEvent({ type: 'card_closed', seq: 4, at: 'x', cardId: 'c', state: 'approved', answer: '좋아' })).toMatchObject({ type: 'card_closed', answer: '좋아' });
    expect(decodeEvent({ type: 'delegation', seq: 5, at: 'x', bot: { id: 'dev', name: '개발 봇' }, botChannel: 'dev', task: 't', state: 'done' }))
      .toMatchObject({ type: 'delegation', state: 'done', botChannel: 'dev' });
  });

  it('reads who a bot was talking to (R17)', () => {
    expect(decodeEvent({ type: 'message', seq: 3, at: 'x', role: 'assistant', text: 't', channel: 'dev', author: { id: 'dev', name: '개발 팀장' }, to: { id: 'dev-1', name: '개발 직원 1' } }))
      .toMatchObject({ author: { name: '개발 팀장' }, to: { id: 'dev-1', name: '개발 직원 1' } });
    expect(decodeEvent({ type: 'message', seq: 4, at: 'x', role: 'assistant', text: 't', to: 'nobody' })).toMatchObject({ to: undefined });
  });

  it('keeps unknown and broken events only for their seq', () => {
    expect(decodeEvent({ type: 'reaction', seq: 9, at: 'x' })).toMatchObject({ type: 'unknown', rawType: 'reaction', seq: 9 });
    expect(decodeEvent({ type: 'message', seq: 10, at: 'x', role: 'robot', text: 'x' })).toMatchObject({ type: 'unknown', seq: 10 });
    expect(decodeEvent({ type: 'card', seq: 11 })).toMatchObject({ type: 'unknown' });
  });

  it('refuses things that are not events', () => {
    expect(decodeEvent(null)).toBeNull();
    expect(decodeEvent({ seq: 1 })).toBeNull();
    expect(decodeEvent({ type: 'message', seq: 'one' })).toBeNull();
    expect(decodeEventText('not json')).toBeNull();
  });

  it('defaults a missing delegation state to started and a missing channel to the main room', () => {
    const e = decodeEvent({ type: 'delegation', seq: 5, at: 'x', bot: { id: 'dev' }, botChannel: 'dev', task: 't' })!;
    expect(e).toMatchObject({ state: 'started', bot: { name: 'dev' } });
    expect(roomOf(e)).toBe('');
  });

  it('question key: topic wins, else context + question', () => {
    const card = { type: 'card', seq: 1, at: '', cardId: 'a', summary: 'q', effects: [], effectLabels: [], note: 'n' } as CardEvent;
    expect(questionKey(card)).toBe('n\u001fq');
    expect(questionKey({ ...card, topic: 'drive:save' })).toBe('drive:save');
  });
});
