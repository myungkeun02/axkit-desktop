import { describe, expect, it } from 'vitest';
import { editBotBody, moveTargets, renameTeamBody } from './botEdit';
import type { BotsView, Team } from './views';

const dev: Team = { id: 't1', name: '개발팀', purpose: '앱을 만들어요', channel: 'c1', members: ['lead', 'a'] };
const ops: Team = { id: 't2', name: '운영팀', channel: 'c2', members: ['b'] };
const shop: Team = { id: 't3', name: '매장팀', channel: 'c3', members: ['c'] };
const bots: BotsView = {
  groups: [
    { id: 'g1', label: '에이컴퍼니', bots: [{ id: 'lead', name: '리드', channel: 'c1', rank: 'lead' }, { id: 'a', name: '에이', role: '프론트엔드', channel: 'c1', rank: 'staff' }, { id: 'b', name: '비', channel: 'c2' }], teams: [dev, ops] },
    { id: 'g2', label: '베타랩', bots: [{ id: 'c', name: '씨', channel: 'c3' }], teams: [shop] },
  ],
};

describe('bot edits (§37)', () => {
  it('renames a team, sending the purpose only when it changed', () => {
    expect(renameTeamBody(dev, ' 앱개발팀 ', '앱을 만들어요')).toEqual({ body: { teamId: 't1', name: '앱개발팀' } });
    expect(renameTeamBody(dev, '개발팀', '웹도 만들어요')).toEqual({ body: { teamId: 't1', name: '개발팀', purpose: '웹도 만들어요' } });
    expect(renameTeamBody(dev, '  ', '')).toEqual({ problem: '팀 이름을 적어 주세요.' });
    expect('problem' in renameTeamBody(dev, 'x'.repeat(41), '')).toBe(true);
  });
  it('edits only what changed on a bot', () => {
    const a = bots.groups[0].bots[1];
    expect(editBotBody(a, '에이', '프론트엔드')).toBeNull();
    expect(editBotBody(a, '에이스', '프론트엔드')).toEqual({ body: { botId: 'a', name: '에이스' } });
    expect(editBotBody(a, '에이', '디자인 시스템')).toEqual({ body: { botId: 'a', role: '디자인 시스템' } });
    expect(editBotBody(a, '에이', '디')).toEqual({ problem: '역할은 2자 이상 적어 주세요.' });
    expect(editBotBody(a, '', '프론트엔드')).toEqual({ problem: '이름을 적어 주세요.' });
  });
  it('offers the other teams, none for a team lead', () => {
    const [lead, a] = bots.groups[0].bots;
    expect(moveTargets(bots, a, dev)).toEqual([{ id: 't2', label: '에이컴퍼니 · 운영팀' }, { id: 't3', label: '베타랩 · 매장팀' }]);
    expect(moveTargets(bots, lead, dev)).toEqual([]);
    const one: BotsView = { groups: [bots.groups[0]] };
    expect(moveTargets(one, a, dev)).toEqual([{ id: 't2', label: '운영팀' }]);
  });
});
