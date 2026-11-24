import { describe, expect, it } from 'vitest';
import { allTeams, botFor, groupForMeeting, showsMeeting, teamFor, teamMembers, type BotsView } from './views';

const bots: BotsView = {
  groups: [
    { id: 'hanbit', label: '한빛랩', meetingChannel: 'meeting:hanbit',
      teams: [{ id: 'dev', name: '개발팀', channel: 'dev', members: ['dev-review', 'dev-1', 'dev'] }, { id: 'design', name: '디자인팀', channel: 'design', members: ['design'] }],
      bots: [
        { id: 'dev-1', name: '개발 직원 1', channel: 'dev', rank: 'staff', team: 'dev' },
        { id: 'dev', name: '개발 팀장', channel: 'dev', rank: 'lead', team: 'dev' },
        { id: 'dev-review', name: '개발 검수', channel: 'dev', rank: 'reviewer', team: 'dev' },
        { id: 'design', name: '디자인 팀장', channel: 'design', rank: 'lead', team: 'design' },
      ] },
    { id: 'me', label: '나', meetingChannel: 'meeting:me', teams: [{ id: 'money', name: '가계부팀', channel: 'money', members: [] }], bots: [] },
    { id: 'old', label: '옛 서버', bots: [{ id: 'x', name: 'X 봇', channel: 'x' }] },
  ],
};

describe('bots view helpers (R16, R17)', () => {
  it('finds the lead for a team room and plain bots for older servers', () => {
    expect(botFor(bots, 'dev')?.name).toBe('개발 팀장');
    expect(botFor(bots, 'x')?.name).toBe('X 봇');
  });
  it('lists members lead first, then staff, then reviewers', () => {
    expect(teamMembers(bots, teamFor(bots, 'dev')!).map((b) => b.id)).toEqual(['dev', 'dev-1', 'dev-review']);
  });
  it('shows a meeting room only for companies with more than one team', () => {
    expect(showsMeeting(bots.groups[0])).toBe(true);
    expect(showsMeeting(bots.groups[1])).toBe(false);
    expect(groupForMeeting(bots, 'meeting:hanbit')?.label).toBe('한빛랩');
    expect(allTeams(bots).map((t) => t.group.id)).toEqual(['hanbit', 'hanbit', 'me']);
  });
});
