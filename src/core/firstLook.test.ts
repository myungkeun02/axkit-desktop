import { describe, expect, it } from 'vitest';
import { activeLabel, countsLine, decodeFirstLook, decodeRevised, elapsedLine, errorLine, relationLabel } from './firstLook';

const raw = {
  status: 'running', phase: 'projects', percent: 42.4, startedAt: '2026-11-23T00:00:00Z',
  phases: [
    { id: 'local', label: '폴더 파일', done: 120, total: 400, state: 'done' },
    { id: 'projects', label: '프로젝트 문서·대화 기록', done: 12, total: 40, state: 'active' },
    { id: 'drive', label: '드라이브', done: 0, total: 0, state: 'waiting' },
    { id: 'signals', label: '메일·일정', done: 0, total: 0, state: 'waiting' },
    { id: 'profile', label: '정리', done: 0, total: 0, state: 'waiting' },
  ],
  counts: { files: 120 },
};

describe('first look (§27)', () => {
  it('reads progress', () => {
    const f = decodeFirstLook(raw);
    expect(f.percent).toBe(42);
    expect(countsLine(f)).toBe('폴더 파일 120/400 · 프로젝트 문서·대화 기록 12/40');
    expect(activeLabel(f)).toBe('프로젝트 문서·대화 기록');
    expect(elapsedLine(f, Date.parse('2026-11-23T00:12:30Z'))).toBe('12분째');
    expect(decodeFirstLook({ ...raw, status: 'done', percent: 97, finishedAt: '2026-11-23T01:03:00Z' })).toMatchObject({ percent: 100 });
    expect(elapsedLine(decodeFirstLook({ ...raw, status: 'done', finishedAt: '2026-11-23T01:03:00Z' }))).toBe('1시간 3분 걸렸어요');
    expect(decodeFirstLook({ status: 'weird' }).status).toBe('idle');
    expect(errorLine('model_unavailable')).toMatch(/AI 모델/);
  });

  it('reads the result and a revision', () => {
    const result = {
      about: '개발자 겸 운영자',
      companies: [
        { name: '에이컴퍼니', relation: 'employer', projects: [
          { name: '베타랩', purpose: '학습 플랫폼', team: { kind: 'dev', roles: [{ title: '개발', does: '기능을 만들어요' }, { title: '' }] },
            routines: [{ title: '주간 점검', when: '매주 월 09:00', schedule: { kind: 'weekly', day: 'mon', at: '09:00' } }] },
          { name: '' },
        ] },
        { name: '' },
      ],
      plan: { id: 'p1', status: 'proposed' },
    };
    const f = decodeFirstLook({ status: 'done', result });
    expect(f.result?.companies).toHaveLength(1);
    expect(f.result?.companies[0].projects).toMatchObject([{ name: '베타랩', team: { kind: 'dev', roles: [{ title: '개발' }] }, routines: [{ when: '매주 월 09:00' }] }]);
    expect(f.result?.plan).toEqual({ id: 'p1', status: 'proposed' });
    expect(relationLabel('own')).toBe('내 회사');
    const r = decodeRevised({ text: '이렇게 바꿨어요', changed: ['a', 1], skipped: [], result: { ...result, plan: null } });
    expect(r).toMatchObject({ text: '이렇게 바꿨어요', changed: ['a'], result: { plan: null } });
  });
});
