import { describe, expect, it } from 'vitest';
import { areasOf, documentOf, groupsFromGraph, recentDocs, searchDocs } from './knowledge';
import { ago } from './format';
import { fixRequest, healthOf, problems } from './health';

describe('knowledge (both servers)', () => {
  it('reads ax-hq areas', () => {
    const areas = areasOf({ areas: [{ id: 'company', label: '회사', summary: '규칙', docs: [{ id: 'd1', title: '예산', updatedAt: '2026-11-18T00:00:00Z' }] }] });
    expect(areas).toEqual([{ id: 'company', label: '회사', summary: '규칙', docs: [{ id: 'd1', title: '예산', summary: undefined, updatedAt: '2026-11-18T00:00:00Z' }] }]);
  });
  it('groups ax-kit documents by kind', () => {
    const areas = areasOf({ documents: [{ name: 'me', title: '나에 대해', kind: 'profile', lines: 12 }, { name: 'readme', title: '개요', kind: 'readme', lines: 3 }, { name: 'p', title: '한빛 앱', kind: 'project', lines: 5 }] });
    expect(areas.map((a) => a.label)).toEqual(['개요', '나', '프로젝트']);
    expect(areas[1].docs[0]).toMatchObject({ id: 'me', summary: '12줄' });
  });
  it('lists recent documents newest first, each once', () => {
    const areas = areasOf({ areas: [
      { id: 'a', label: 'A', docs: [{ id: 'x', title: 'X', updatedAt: '2026-11-17T00:00:00Z' }, { id: 'y', title: 'Y', updatedAt: '2026-11-19T00:00:00Z' }] },
      { id: 'b', label: 'B', docs: [{ id: 'x', title: 'X', updatedAt: '2026-11-17T00:00:00Z' }, { id: 'z', title: 'Z' }] },
    ] });
    expect(recentDocs(areas).map((d) => d.id)).toEqual(['y', 'x']);
    expect(searchDocs(areas, 'z').map((a) => a.id)).toEqual(['b']);
  });
  it('reads one document from either shape', () => {
    expect(documentOf({ document: { id: 'd1', title: 'T', markdown: '# 본문' } })).toMatchObject({ id: 'd1', markdown: '# 본문' });
    expect(documentOf({ document: { name: 'me', title: '나', markdown: '', lines: [{ text: '커피를 좋아해요' }] } })?.markdown).toBe('- 커피를 좋아해요');
    expect(documentOf({ document: null })).toBeNull();
  });
});

describe('health (both servers)', () => {
  it('reads ax-hq checks, problems first', () => {
    const h = healthOf({ summary: '2가지만', checks: [{ id: 'a', label: 'AX 서버', status: 'ok' }, { id: 'b', label: '키', status: 'warn', detail: '만료' }, { id: 'c', label: '디스크', status: 'fail' }] });
    expect(h.checks.map((c) => c.status)).toEqual(['error', 'warn', 'ok']);
    expect(problems(h)).toHaveLength(2);
    expect(fixRequest(h)).toContain('- 키: 만료');
  });
  it('reads ax-kit findings', () => {
    const h = healthOf({ checkedAt: 'x', findings: [{ id: 'llm', area: 'AI 연결', ok: false, line: '키가 없어요', fix: 'ax-kit setup' }, { id: 'db', area: '저장소', ok: true, line: '괜찮아요' }] });
    expect(h.checks[0]).toEqual({ id: 'llm', label: '키가 없어요', status: 'warn', fix: 'ax-kit setup' });
  });
});

describe('one 문서 list', () => {
  it('groups docgraph nodes by layer, with the layer colour, skipping empty layers', () => {
    const g = groupsFromGraph({ layers: [{ id: 'c', label: '회사' }, { id: 'p', label: '사람' }], nodes: [{ id: 'n1', title: '한빛랩', layer: 'c', summary: '회사', updatedAt: 'x' }] }, (i) => ['#00f', '#f00'][i]);
    expect(g).toEqual([{ id: 'c', label: '회사', summary: undefined, color: '#00f', docs: [{ id: 'n1', title: '한빛랩', summary: '회사', updatedAt: 'x' }] }]);
  });
  it('says how long ago in days', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    expect(ago(now - 30_000, now)).toBe('방금');
    expect(ago(now - 3 * 3600_000, now)).toBe('3시간 전');
    expect(ago(now - 26 * 3600_000, now)).toBe('1일 전');
    expect(ago(now - 12 * 86_400_000, now)).toBe('12일 전');
  });
});
