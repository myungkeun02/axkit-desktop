import { describe, expect, it } from 'vitest';
import { decodeBuiltTeam, teamTextProblem } from './teamFromText';

describe('team from a description (§37)', () => {
  it('asks for a little more, or less', () => {
    expect(teamTextProblem('영상')).toBe('어떤 팀인지 조금만 더 적어 주세요.');
    expect(teamTextProblem('유튜브 영상 제작팀')).toBeNull();
    expect(teamTextProblem('가'.repeat(6001))).toContain('6,000자');
  });
  it('reads what the Mac built', () => {
    expect(decodeBuiltTeam({ teamId: 't9', channel: 'video', group: 'g1', name: '영상 제작팀', purpose: '주 2회 영상', briefKept: true,
      members: [{ id: 'b1', name: '기획', role: '주제와 구성을 잡아요' }, { id: '', name: 'x' }, null] }))
      .toEqual({ teamId: 't9', channel: 'video', group: 'g1', name: '영상 제작팀', purpose: '주 2회 영상', briefKept: true, members: [{ id: 'b1', name: '기획', role: '주제와 구성을 잡아요' }] });
    expect(decodeBuiltTeam({ teamId: 't9' })).toBeNull();
    expect(decodeBuiltTeam({ teamId: 't', channel: 'c', name: 'n' })?.briefKept).toBe(false);
  });
});
