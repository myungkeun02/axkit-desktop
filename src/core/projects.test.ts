import { describe, expect, it } from 'vitest';
import {
  changed, companiesOf, decodeProjects, draftOf, mergeDraft, moveProject, nameProblem, pick, pickCompany, renameCompany, renameProject, saveBody, scanCounts, scanTitle, sessionsLine,
} from './projects';

const view = () => decodeProjects({
  companies: [
    { name: '에이컴퍼니', projects: [
      { path: '/u/dev/acompany/web', display: '~/dev/acompany/web', name: 'acompany-web', company: '에이컴퍼니', remote: 'github.com/acompany/acompany-web', lastActive: '2026-11-20T03:00:00.000Z', claude: 12, codex: 3, picked: true },
      { path: '/u/dev/acompany/api', display: '~/dev/acompany/api', name: 'acompany-api', company: '에이컴퍼니', lastActive: '2026-11-18T03:00:00.000Z', claude: 0, codex: 2, picked: false },
    ] },
    { name: '개인', projects: [
      { path: '/u/old', display: '/u/old', name: 'old', company: '개인', claude: 0, codex: 0, picked: true },
      { path: 7 },
    ] },
  ],
  picked: 2,
  scan: { status: 'running', phase: 'projects', counts: { repos: 4, files: 1203, docs: 0, sessions: 58 } },
});

describe('projects', () => {
  it('reads the view and skips broken rows', () => {
    const v = view();
    expect(v.companies.map((c) => c.projects.length)).toEqual([2, 1]);
    expect(v.companies[1].projects[0].lastActive).toBeUndefined();
    expect(scanTitle(v.scan)).toBe('프로젝트를 읽는 중');
    expect(scanCounts(v.scan)).toBe('저장소 4 · 파일 1,203 · 대화 기록 58');
    expect(sessionsLine(v.companies[0].projects[0])).toBe('Claude 대화 12 · Codex 대화 3');
    expect(sessionsLine(v.companies[1].projects[0])).toBeNull();
    expect(scanTitle({ status: 'idle' })).toBe('아직 읽지 않았어요');
  });

  it('sends every picked project with its edited name and company', () => {
    const v = view();
    let d = draftOf(v);
    expect(changed(d, v)).toBe(false);
    d = pick(d, '/u/dev/acompany/api', true);
    d = renameProject(d, '/u/dev/acompany/api', ' 오키 API ');
    d = moveProject(d, '/u/old', '사이드');
    expect(changed(d, v)).toBe(true);
    expect(saveBody(d, true)).toEqual({ rescan: true, projects: [
      { path: '/u/dev/acompany/web', name: 'acompany-web', company: '에이컴퍼니' },
      { path: '/u/dev/acompany/api', name: '오키 API', company: '에이컴퍼니' },
      { path: '/u/old', name: 'old', company: '사이드' },
    ] });
    expect(companiesOf(d).map((c) => `${c.name}:${c.picked}/${c.projects.length}`)).toEqual(['에이컴퍼니:2/2', '사이드:1/1']);
  });

  it('renames a company (merging into an existing one) and picks a whole company, never a missing folder', () => {
    const v = view();
    let d = renameCompany(draftOf(v), '개인', '에이컴퍼니');
    expect(companiesOf(d).map((c) => c.name)).toEqual(['에이컴퍼니']);
    d = pickCompany(draftOf(v), '개인', false);
    expect(d.rows.find((r) => r.path === '/u/old')!.picked).toBe(false);
    d = pickCompany(d, '개인', true);
    expect(d.rows.find((r) => r.path === '/u/old')!.picked).toBe(false);
    expect(nameProblem('  ')).toBe('이름을 써 주세요.');
    expect(nameProblem('x'.repeat(81))).toBe('이름은 80자까지예요.');
    expect(nameProblem('에이컴퍼니')).toBeNull();
  });

  it('keeps unsaved edits across a refresh', () => {
    const v = view();
    const d = pick(draftOf(v), '/u/dev/acompany/api', true);
    const fresh = decodeProjects({ companies: [{ name: '에이컴퍼니', projects: [
      { path: '/u/dev/acompany/new', name: 'new', company: '에이컴퍼니', lastActive: '2026-11-22T00:00:00Z', claude: 1, codex: 0, picked: false },
      { path: '/u/dev/acompany/api', name: 'acompany-api', company: '에이컴퍼니', lastActive: '2026-11-18T03:00:00.000Z', claude: 0, codex: 2, picked: false },
    ] }], scan: { status: 'idle' } });
    const m = mergeDraft(d, fresh, v);
    expect(m.rows.map((r) => `${r.path}:${r.picked}`)).toEqual(['/u/dev/acompany/new:false', '/u/dev/acompany/api:true']);
  });
});
