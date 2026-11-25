// §37 봇 화면에서 바로 고치기: renameTeam / editBot / moveBot on views/bots, applied at once (no 결재 card).
import { allTeams, type Bot, type BotsView, type Team } from './views';

/** The Mac's limits (bots-edit.ts): names 1–40, a purpose up to 200, a role 2–120. */
export const EDIT_MAX = { name: 40, purpose: 200, role: 120 } as const;
export const ROLE_MIN = 2;

export const canEdit = (actions: string[]) => ({
  renameTeam: actions.includes('renameTeam'),
  editBot: actions.includes('editBot'),
  moveBot: actions.includes('moveBot'),
  deleteTeam: actions.includes('deleteTeam'),
});

/** The body for renameTeam, or the reason it can't be sent. Purpose is sent only when it changed. */
export function renameTeamBody(team: Team, name: string, purpose: string): { body: Record<string, string> } | { problem: string } {
  const n = name.trim();
  const p = purpose.trim();
  if (!n) return { problem: '팀 이름을 적어 주세요.' };
  if (n.length > EDIT_MAX.name) return { problem: `팀 이름은 ${EDIT_MAX.name}자까지예요.` };
  if (p.length > EDIT_MAX.purpose) return { problem: `하는 일은 ${EDIT_MAX.purpose}자까지예요.` };
  return { body: { teamId: team.id, name: n, ...(p !== (team.purpose ?? '').trim() ? { purpose: p } : {}) } };
}

/** The body for editBot with only what changed, or the reason; null when nothing changed. */
export function editBotBody(bot: Bot, name: string, role: string): { body: Record<string, string> } | { problem: string } | null {
  const n = name.trim();
  const r = role.trim();
  if (!n) return { problem: '이름을 적어 주세요.' };
  if (n.length > EDIT_MAX.name) return { problem: `이름은 ${EDIT_MAX.name}자까지예요.` };
  if (r && r.length < ROLE_MIN) return { problem: `역할은 ${ROLE_MIN}자 이상 적어 주세요.` };
  if (r.length > EDIT_MAX.role) return { problem: `역할은 ${EDIT_MAX.role}자까지예요.` };
  const body: Record<string, string> = {};
  if (n !== bot.name) body.name = n;
  if (r && r !== (bot.role ?? '').trim()) body.role = r;
  return Object.keys(body).length ? { body: { botId: bot.id, ...body } } : null;
}

/** Teams a member can move to (every other team, grouped by company label), or none for a team lead. */
export function moveTargets(bots: BotsView | null, bot: Bot, from: Team): { id: string; label: string }[] {
  if (bot.rank === 'lead') return [];
  const teams = allTeams(bots);
  const companies = new Set(teams.map((t) => t.group.id));
  return teams.filter((t) => t.id !== from.id).map((t) => ({ id: t.id, label: companies.size > 1 ? `${t.group.label} · ${t.name}` : t.name }));
}
