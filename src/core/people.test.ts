import { describe, expect, it } from 'vitest';
import { decodePeople, editBody, formOf, matchesPerson, roleLine } from './people';

const raw = {
  title: '사람',
  people: [
    { key: 'p1', name: '김민수', names: ['김민수', '김 대표님'], title: '대표', company: '에이컴퍼니', relation: '내가 일하는 회사 대표', note: '결정이 빠름\n월요일 회의', emails: 2, openCommitments: 2, updatedAt: '2026-11-24T01:00:00Z' },
    { key: 'p2', name: '이수진', relation: '지인' },
    { key: '', name: '빈 키' },
    null,
  ],
};

describe('people', () => {
  it('reads the cards and skips broken ones', () => {
    const people = decodePeople(raw);
    expect(people.map((p) => p.key)).toEqual(['p1', 'p2']);
    expect(people[1]).toMatchObject({ names: ['이수진'], emails: 0, openCommitments: 0 });
    expect(roleLine(people[0])).toBe('대표 · 에이컴퍼니');
    expect(roleLine(people[1])).toBe('');
    expect(decodePeople(undefined)).toEqual([]);
  });

  it('finds a person by any name, company or relation', () => {
    const [roh, lee] = decodePeople(raw);
    expect(matchesPerson(roh, '김대표')).toBe(true);
    expect(matchesPerson(roh, '에이 컴퍼니')).toBe(true);
    expect(matchesPerson(lee, '지인')).toBe(true);
    expect(matchesPerson(lee, '에이컴퍼니')).toBe(false);
    expect(matchesPerson(lee, '  ')).toBe(true);
  });

  it('sends only what changed, and an emptied box as ""', () => {
    const [roh] = decodePeople(raw);
    expect(editBody(roh, formOf(roh))).toEqual({ key: 'p1' });
    expect(editBody(roh, { ...formOf(roh), title: ' 공동대표 ', company: '' })).toEqual({ key: 'p1', title: '공동대표', company: '' });
    expect(editBody(roh, { ...formOf(roh), note: '결정이 빠름\n월요일 회의\n' })).toEqual({ key: 'p1' });
  });
});
