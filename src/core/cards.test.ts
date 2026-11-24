import { describe, expect, it } from 'vitest';
import { answerFor, cardBody, cardPath, closedLabel, defaultOptions, optionsFor } from './cards';
import type { CardEvent } from './events';

const card = (extra: Partial<CardEvent> = {}): CardEvent => ({ type: 'card', seq: 1, at: '', cardId: 'c', summary: 'q', effects: [], effectLabels: [], ...extra });

describe('cards', () => {
  it('falls back to the classic three decisions in easy words', () => {
    expect(defaultOptions(card({ effects: ['pay'] }))[0].label).toBe('네, 결제해요');
    expect(defaultOptions(card({ effects: ['send'] }))[0].label).toBe('네, 보내요');
    expect(optionsFor(card()).map((o) => answerFor(o))).toEqual([{ decision: 'approve' }, { decision: 'edit' }, { decision: 'deny' }]);
    expect(optionsFor(card({ options: [{ id: 'x', label: 'X' }] }))).toEqual([{ id: 'x', label: 'X' }]);
  });

  it('only sends remember with a yes', () => {
    expect(cardBody({ option: 'a' }, true, { id: 'a', label: 'A', tone: 'primary' })).toEqual({ option: 'a', remember: true });
    expect(cardBody({ option: 'n' }, true, { id: 'n', label: 'N', tone: 'danger' })).toEqual({ option: 'n' });
    expect(cardBody({ text: 'hi' }, true)).toEqual({ text: 'hi' });
    expect(cardBody({ decision: 'approve' }, true)).toEqual({ decision: 'approve', remember: true });
    expect(cardBody({ option: 'a' }, false)).toEqual({ option: 'a' });
  });

  it('labels finished cards plainly', () => {
    expect(closedLabel({ type: 'card_closed', seq: 1, at: '', cardId: 'c', state: 'closed', answer: '내일' }, false)).toBe('답함: 내일');
    expect(closedLabel({ type: 'card_closed', seq: 1, at: '', cardId: 'c', state: 'denied' }, false)).toBe('안 하기로 했어요');
    expect(closedLabel(undefined, true)).toBe('시간이 지나 닫혔어요');
  });

  it('encodes card ids for the path', () => {
    expect(cardPath('org:d:1')).toBe('cards/org%3Ad%3A1');
  });
});

describe('cards that open a screen', () => {
  it('the team-structure card\'s fix-in-app opens the screen and sends nothing', async () => {
    const { opensInApp } = await import('./cards');
    const card = { topic: 'bots:team-plan:p1' } as Parameters<typeof opensInApp>[0];
    expect(opensInApp(card, { id: 'fix-in-app', label: '앱에서 고칠게요' })).toBe('team-plan');
    expect(opensInApp(card, { id: 'build', label: '이대로 만들기' })).toBeNull();
    expect(opensInApp({ topic: 'other' } as typeof card, { id: 'fix-in-app', label: 'x' })).toBeNull();
  });
});
