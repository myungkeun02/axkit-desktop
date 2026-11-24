import { describe, expect, it } from 'vitest';
import { insertMention, mentionAt, mentionMatches } from './mention';

const bots = [{ name: '개발 봇' }, { name: 'QA 봇' }, { name: '디자인' }, { name: '개발 봇' }, { name: 'betalab 개발' }];

describe('mention', () => {
  it('finds the @ being typed, not an email address', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('이거 @개발', 6)).toEqual({ start: 3, query: '개발' });
    expect(mentionAt('me@mail.com', 11)).toBeNull();
    expect(mentionAt('@개발 봇한테 이거 맡기고 끝나면 알려 줘', 24)).toBeNull();
    expect(mentionAt('@개발\n다음', 7)).toBeNull();
    expect(mentionAt('글', 1)).toBeNull();
  });
  it('matches names that start with it first, spaces and case ignored, each once', () => {
    expect(mentionMatches(bots, '').map((b) => b.name)).toEqual(['개발 봇', 'QA 봇', '디자인', 'betalab 개발']);
    expect(mentionMatches(bots, '개발봇').map((b) => b.name)).toEqual(['개발 봇']);
    expect(mentionMatches(bots, '개발').map((b) => b.name)).toEqual(['개발 봇', 'betalab 개발']);
    expect(mentionMatches(bots, 'qa').map((b) => b.name)).toEqual(['QA 봇']);
    expect(mentionMatches(bots, '없음')).toEqual([]);
    expect(mentionMatches(bots, '개발 봇 ')).toEqual([]);
    expect(mentionMatches(bots, '개발 ').map((b) => b.name)).toEqual(['개발 봇', 'betalab 개발']);
  });
  it('puts @name and a space in place of what was typed', () => {
    expect(insertMention('이거 @개 해 줘', 3, 5, '개발 봇')).toEqual({ value: '이거 @개발 봇 해 줘', caret: 9 });
    expect(insertMention('@', 0, 1, 'QA 봇')).toEqual({ value: '@QA 봇 ', caret: 6 });
  });
});
