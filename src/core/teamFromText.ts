// §37 (추가) 설명으로 팀 만들기: POST views/bots/createTeamFromText {text, group?} →
// {teamId, channel, group, name, purpose, members:[{id,name,role}], briefKept}. The Mac's model turns the owner's own
// words into a name, a purpose, 2–6 members named after their jobs, and a brief kept with the lead as the owner's instructions.

export const TEAM_TEXT_MIN = 5;
export const TEAM_TEXT_MAX = 6000;

export const TEAM_TEXT_PLACEHOLDER = [
  '예) 유튜브 영상 제작팀이 필요해요.',
  '- 매주 화·금 영상 2개: 기획 → 대본 → 촬영 목록 → 편집 지시 → 썸네일·제목',
  '- 채널은 "모아카페 TV", 20~30대 직장인 대상, 말투는 친근하게',
  '- 편집은 외주 편집자에게 넘기니 편집 지시서를 꼭 써 줘요',
  '- 올리기 전엔 꼭 저한테 물어봐 주세요',
].join('\n');

export function teamTextProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < TEAM_TEXT_MIN) return '어떤 팀인지 조금만 더 적어 주세요.';
  if (t.length > TEAM_TEXT_MAX) return `${TEAM_TEXT_MAX.toLocaleString('ko-KR')}자까지 적을 수 있어요.`;
  return null;
}

export interface BuiltTeam {
  teamId: string; channel: string; group?: string; name: string; purpose: string;
  members: { id: string; name: string; role: string }[];
  briefKept: boolean;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

export function decodeBuiltTeam(raw: unknown): BuiltTeam | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const teamId = str(r.teamId), channel = str(r.channel), name = str(r.name);
  if (!teamId || !channel || !name) return null;
  const members = (Array.isArray(r.members) ? r.members : []).flatMap((m) => {
    const x = (m ?? {}) as Record<string, unknown>;
    return str(x.id) && str(x.name) ? [{ id: str(x.id), name: str(x.name), role: str(x.role) }] : [];
  });
  return { teamId, channel, ...(str(r.group) ? { group: str(r.group) } : {}), name, purpose: str(r.purpose), members, briefKept: r.briefKept === true };
}
