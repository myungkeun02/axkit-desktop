import { describe, expect, it } from 'vitest';
import { allTeams, botFor, modelLine, rowMessage, rowQuery, teamModels, groupForMeeting, showsMeeting, teamFor, teamMembers, type BotsView } from './views';

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

describe('rowMessage (§34)', () => {
  it('gives the sentence when a row has one', () => {
    expect(rowMessage({ title: '분기 보고서.pdf', message: '드라이브의 "분기 보고서.pdf" 내용을 요약해 줘' })).toBe('드라이브의 "분기 보고서.pdf" 내용을 요약해 줘');
  });
  it('leaves rows without a usable message unpressable', () => {
    expect(rowMessage({ title: 'a' })).toBeUndefined();
    expect(rowMessage({ title: 'a', message: '   ' })).toBeUndefined();
    expect(rowMessage({ title: 'a', message: 3 as unknown as string })).toBeUndefined();
  });
});

describe('bot models', () => {
  it('shows the model next to the tier, or the tier alone', () => {
    expect(modelLine({ tier: 'B', model: 'Claude Sonnet 5.5 · Claude' })).toBe('등급 B · Claude Sonnet 5.5 · Claude');
    expect(modelLine({ tier: 'A' })).toBe('등급 A');
    expect(modelLine({})).toBe('');
  });
  it('names the models of a team once', () => {
    expect(teamModels([{ model: 'Opus · 구독' }, { model: 'Opus · 구독' }, {}])).toBe('Opus · 구독');
    expect(teamModels([{ model: 'a' }, { model: 'b' }, { model: 'c' }, { model: 'd' }])).toBe('a / b 외 2');
    expect(teamModels([{}])).toBe('');
  });
});

describe('rowQuery (§38)', () => {
  it('turns a row query into view parameters', () => {
    expect(rowQuery({ title: '기획', query: { mode: 'tree', source: 'my', folder: 'f1', depth: 2, shared: false } }))
      .toEqual({ mode: 'tree', source: 'my', folder: 'f1', depth: '2', shared: 'false' });
    expect(rowQuery({ title: '처음', query: {} })).toEqual({});
    expect(rowQuery({ title: 'x', query: { a: { b: 1 }, c: null } })).toEqual({});
    expect(rowQuery({ title: '파일' })).toBeUndefined();
    expect(rowQuery({ title: 'x', query: ['a'] })).toBeUndefined();
  });
});
