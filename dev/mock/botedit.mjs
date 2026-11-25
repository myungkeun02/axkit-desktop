// §37 봇 화면에서 바로 고치기 (server d75b949): views/bots actions renameTeam, editBot, moveBot — applied at once.
// POST views/bots/renameTeam {teamId, name, purpose?} → {teamId, name}
// POST views/bots/editBot {botId, name?, role?}       → {botId, name, role}
// POST views/bots/moveBot {botId, teamId}             → {botId, teamId}  (a team lead: 400 with the owner's sentence)
// The changes are kept here and laid over the upstream views/bots. /dev/botedit clears them.

const ACTIONS = ['renameTeam', 'editBot', 'moveBot'];
let teams = new Map(); // teamId → {name, purpose?}
let bots = new Map(); // botId → {name?, role?}
let moves = new Map(); // botId → teamId

export function devReset() { teams = new Map(); bots = new Map(); moves = new Map(); }

/** The upstream view with this mock's edits applied. */
function apply(data) {
  const groups = data.groups.map((g) => ({ ...g, bots: (g.bots ?? []).map((b) => ({ ...b, ...(bots.get(b.id) ?? {}) })) }));
  const allTeams = groups.flatMap((g) => (g.teams ?? []).map((t) => ({ t, g })));
  for (const { t } of allTeams) {
    Object.assign(t, teams.get(t.id) ?? {});
    t.members = t.members.filter((id) => !moves.has(id) || moves.get(id) === t.id);
  }
  for (const [botId, teamId] of moves) {
    const hit = allTeams.find(({ t }) => t.id === teamId);
    if (!hit) continue;
    if (!hit.t.members.includes(botId)) hit.t.members = [...hit.t.members, botId];
    const from = groups.find((g) => g.bots.some((b) => b.id === botId));
    const bot = from?.bots.find((b) => b.id === botId);
    if (bot) {
      bot.team = teamId; bot.channel = hit.t.channel;
      if (from !== hit.g) { from.bots = from.bots.filter((b) => b.id !== botId); hit.g.bots = [...hit.g.bots, bot]; }
    }
  }
  return { ...data, groups };
}

export async function augment({ path, json }) {
  if (!json?.ok) return json;
  if (path === 'capabilities') {
    return { ...json, views: (json.views ?? []).map((v) => (v.name === 'bots' ? { ...v, actions: [...new Set([...(v.actions ?? []), ...ACTIONS])] } : v)) };
  }
  if (path === 'views/bots' && json.data?.groups) return { ...json, data: apply(structuredClone(json.data)) };
  return json;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

export async function handle({ req, res, path, send, token, upstream }) {
  const m = /^views\/bots\/(renameTeam|editBot|moveBot)$/.exec(path ?? '');
  if (req.method !== 'POST' || !m) return false;
  const body = await readJson(req);
  const view = apply((await upstream('/m/v1/app/views/bots', token)).data);
  const allTeams = view.groups.flatMap((g) => g.teams ?? []);
  const allBots = view.groups.flatMap((g) => g.bots ?? []);
  const reply = (data) => send(res, 200, { ok: true, view: 'bots', action: m[1], data });
  const owner = (message) => send(res, 400, { ok: false, error: 'invalid_input', message });
  if (m[1] === 'renameTeam') {
    if (!str(body.name, 1, 40) || (body.purpose !== undefined && !str(body.purpose, 0, 200))) return send(res, 400, { ok: false, error: 'invalid_input' }), true;
    const t = allTeams.find((x) => x.id === body.teamId);
    if (!t) return owner('그런 팀이 없어요'), true;
    teams.set(t.id, { ...(teams.get(t.id) ?? {}), name: body.name.trim(), ...(body.purpose !== undefined ? { purpose: body.purpose.trim() } : {}) });
    return reply({ teamId: t.id, name: body.name.trim() }), true;
  }
  const bot = allBots.find((b) => b.id === body.botId);
  if (!bot) return owner('그런 봇이 없어요'), true;
  if (m[1] === 'editBot') {
    if ((body.name === undefined && body.role === undefined) || (body.name !== undefined && !str(body.name, 1, 40)) || (body.role !== undefined && !str(body.role, 2, 120))) {
      return send(res, 400, { ok: false, error: 'invalid_input' }), true;
    }
    const next = { ...(bots.get(bot.id) ?? {}), ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...(body.role !== undefined ? { role: body.role.trim() } : {}) };
    bots.set(bot.id, next);
    return reply({ botId: bot.id, name: next.name ?? bot.name, role: next.role ?? bot.role }), true;
  }
  const target = allTeams.find((t) => t.id === body.teamId);
  if (!target) return owner('그런 팀이 없어요'), true;
  if (bot.rank === 'lead' && !target.members.includes(bot.id)) return owner('팀장은 옮길 수 없어요. 다른 사람을 옮기거나 팀 이름을 바꿔 주세요.'), true;
  moves.set(bot.id, target.id);
  return reply({ botId: bot.id, teamId: target.id }), true;
}
