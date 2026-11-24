import { describe, expect, it } from 'vitest';
import {
  addRole, appliedLine, decodePlan, editRole, editTeam, kindLabel, planProblem, removeRole, removeRoutine, removeTeam, renameCompany, sameTeams, saveBody, scheduleLabel, tree,
} from './teamPlan';

const raw = {
  plan: {
    id: 'p1', createdAt: '2026-11-23T00:00:00Z', status: 'proposed',
    teams: [
      { company: '스튜디오 오름', name: '브랜드A 리뉴얼', purpose: '로고·가이드 개편', kind: 'general',
        roles: [{ title: '레퍼런스 조사', does: '비슷한 사례를 모아요' }, { title: '' }],
        tasks: ['주간 시안 진행 점검', 3],
        routines: [
          { title: '시안 진행 점검', instruction: '이번 주 시안 진행 상황을 정리해 알려 줘', schedule: { kind: 'weekly', day: 'mon', at: '09:30' } },
          { title: '깨진 루틴', instruction: 'x', schedule: { kind: 'weekly', day: 'xyz', at: '09:30' } },
        ] },
      { company: '개인', name: 'ax-kit', purpose: '', kind: 'dev', roles: [], tasks: [], routines: [{ title: '빌드 확인', instruction: '빌드가 깨졌는지 봐 줘', schedule: { kind: 'every', hours: 6 } }] },
      { company: '스튜디오 오름', name: '운영', kind: 'general' },
      { company: '', name: '이름만' },
    ],
  },
};

describe('team plan', () => {
  it('reads the plan, dropping broken parts', () => {
    expect(decodePlan({ plan: null })).toBeNull();
    const p = decodePlan(raw)!;
    expect(p.teams.map((t) => t.name)).toEqual(['브랜드A 리뉴얼', 'ax-kit', '운영']);
    expect(p.teams[0].roles).toEqual([{ title: '레퍼런스 조사', does: '비슷한 사례를 모아요' }]);
    expect(p.teams[0].tasks).toEqual(['주간 시안 진행 점검']);
    expect(p.teams[0].routines).toHaveLength(1);
    expect(tree(p.teams)).toEqual([{ company: '스튜디오 오름', teams: [0, 2] }, { company: '개인', teams: [1] }]);
    expect(kindLabel(p.teams[1])).toBe('개발팀 · 검수 포함');
  });

  it('says schedules plainly', () => {
    expect(scheduleLabel({ kind: 'weekly', day: 'mon', at: '09:30' })).toBe('매주 월요일 오전 9시 30분');
    expect(scheduleLabel({ kind: 'daily', at: '18:00' })).toBe('매일 오후 6시');
    expect(scheduleLabel({ kind: 'daily', at: '00:05' })).toBe('매일 오전 12시 5분');
    expect(scheduleLabel({ kind: 'every', hours: 6 })).toBe('6시간마다');
  });

  it('edits and checks before saving', () => {
    const p = decodePlan(raw)!;
    let t = removeTeam(p.teams, 2);
    t = renameCompany(t, '개인', '스튜디오 오름 ');
    expect(tree(t)).toEqual([{ company: '스튜디오 오름', teams: [0, 1] }]);
    t = addRole(t, 1);
    expect(planProblem(t)).toBe("'ax-kit'에 역할 이름이 빈 직원이 있어요.");
    t = editRole(t, 1, 0, { title: '이건 스무 글자를 훌쩍 넘기는 아주 긴 역할 이름' });
    expect(planProblem(t)).toMatch(/20자까지/);
    t = editRole(t, 1, 0, { title: ' 백엔드 ' });
    expect(planProblem(t)).toBeNull();
    t = editTeam(t, 0, { name: '  ' });
    expect(planProblem(t)).toBe('팀 이름을 써 주세요.');
    t = editTeam(t, 0, { name: '브랜드A' });
    t = removeRole(removeRoutine(t, 1, 0), 0, 0);
    for (let i = 0; i < 6; i++) t = addRole(t, 0);
    expect(t[0].roles).toHaveLength(6);
    const body = saveBody(t);
    expect(body.teams[1]).toMatchObject({ company: '스튜디오 오름', roles: [{ title: '백엔드', does: '' }], routines: [] });
    expect(sameTeams(p.teams, p.teams)).toBe(true);
    expect(sameTeams(p.teams, t)).toBe(false);
  });

  it('says what apply made', () => {
    expect(appliedLine({ teams: 3, routines: 2 })).toBe('팀 3개와 루틴 2개를 만들었어요.');
    expect(appliedLine({ teams: 1, routines: 0 })).toBe('팀 1개를 만들었어요.');
    expect(appliedLine({ teams: 0, routines: 0 })).toMatch(/이미 만든/);
  });
});
