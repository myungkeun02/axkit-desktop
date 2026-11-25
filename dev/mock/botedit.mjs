// §37 봇 화면에서 바로 고치기 (server d75b949): views/bots actions renameTeam, editBot, moveBot — applied at once.
// POST views/bots/renameTeam {teamId, name, purpose?} → {teamId, name}
// POST views/bots/editBot {botId, name?, role?}       → {botId, name, role}
// POST views/bots/moveBot {botId, teamId}             → {botId, teamId}  (a team lead: 400 with the owner's sentence)
// POST views/bots/createTeamFromText {text, group?} → {teamId, channel, group, name, purpose, members:[{id,name,role}], briefKept}
//   (d5ad883: the real Mac asks a model; this mock takes the team name from the text, makes the team upstream and
//   names the members after jobs it finds in the text, or generic ones.)
// The changes are kept here and laid over the upstream views/bots. /dev/botedit clears them.

const ACTIONS = ['renameTeam', 'editBot', 'moveBot', 'createTeamFromText', 'deleteTeam'];
let teams = new Map(); // teamId → {name, purpose?}
let bots = new Map(); // botId → {name?, role?}
let moves = new Map(); // botId → teamId
let deleted = new Set(); // team ids (5e70340 deleteTeam {teamId, confirm: true}: the team and its members go)

export function devReset() { teams = new Map(); bots = new Map(); moves = new Map(); deleted = new Set(); }

/** The upstream view with this mock's edits applied. */
function apply(data) {
  // d219cb3: `model` on team bots — by tier here; C stays without one (an older server sends none at all).
  const MODEL = { S: 'Claude Opus · Claude Code 구독', A: 'Claude Opus · Claude Code 구독', B: 'Claude Sonnet 5.5 · Claude' };
  const groups = data.groups.map((g) => ({ ...g, bots: (g.bots ?? []).map((b) => ({ ...b, ...(MODEL[b.tier] ? { model: MODEL[b.tier] } : {}), ...(bots.get(b.id) ?? {}) })) }));
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
  for (const g of groups) {
    const gone = new Set((g.teams ?? []).filter((t) => deleted.has(t.id)).flatMap((t) => t.members));
    g.teams = (g.teams ?? []).filter((t) => !deleted.has(t.id));
    g.bots = g.bots.filter((b) => !gone.has(b.id));
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

const JOBS = [
  ['기획', '주제와 구성을 잡아요'], ['대본', '말할 내용과 자막을 써요'], ['촬영', '찍을 장면 목록을 만들어요'],
  ['편집', '편집자에게 줄 편집 지시서를 써요'], ['썸네일', '썸네일과 제목을 뽑아요'], ['디자인', '시안과 이미지를 만들어요'],
  ['마케팅', '알릴 글과 채널을 챙겨요'], ['조사', '자료와 사례를 모아요'],
];

async function createFromText(body, token, upstream, send, res) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 5 || text.length > 6000) return send(res, 400, { ok: false, error: 'invalid_input' });
  const view = (await upstream('/m/v1/app/views/bots', token)).data;
  const group = body.group ?? view.groups[0]?.id;
  const name = (/([가-힣A-Za-z0-9 ]{1,20}팀)/.exec(text)?.[1] ?? '새 팀').trim();
  const purpose = text.split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').trim()).find((l) => l.length > 4 && !l.includes(name))?.slice(0, 80) ?? `${name} 일을 해요`;
  const up = await fetch(`http://127.0.0.1:47796/m/v1/app/views/bots/createTeam`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ group, name, purpose, kind: 'general', auto: true }),
  });
  const made = await up.json();
  if (!made.ok) return send(res, up.status, made);
  await new Promise((r) => setTimeout(r, 1500)); // the real Mac takes a few seconds (a model call)
  const after = apply((await upstream('/m/v1/app/views/bots', token)).data);
  const team = after.groups.flatMap((g) => g.teams ?? []).find((t) => t.id === made.data.teamId);
  const found = JOBS.filter(([job]) => text.includes(job));
  const jobs = found.length >= 2 ? found : JOBS.slice(0, 3);
  const members = (team?.members ?? []).map((id, i) => {
    const bot = after.groups.flatMap((g) => g.bots).find((b) => b.id === id);
    if (i === 0) return { id, name: `${name.replace(/팀$/, '')} 팀장`, role: '팀을 이끌고 오너에게 물어봐요' };
    const [job, does] = jobs[(i - 1) % jobs.length];
    return { id, name: job, role: does, _bot: bot };
  });
  for (const m of members) bots.set(m.id, { name: m.name, role: m.role });
  send(res, 200, { ok: true, view: 'bots', action: 'createTeamFromText', data: {
    teamId: made.data.teamId, channel: made.data.channel, group, name: team?.name ?? name, purpose,
    members: members.map(({ id, name: n, role }) => ({ id, name: n, role })), briefKept: true,
  } });
}

export async function handle({ req, res, path, send, token, upstream }) {
  const m = /^views\/bots\/(renameTeam|editBot|moveBot|createTeamFromText|deleteTeam)$/.exec(path ?? '');
  if (req.method !== 'POST' || !m) return false;
  const body = await readJson(req);
  if (m[1] === 'createTeamFromText') return await createFromText(body, token, upstream, send, res), true;
  const view = apply((await upstream('/m/v1/app/views/bots', token)).data);
  const allTeams = view.groups.flatMap((g) => g.teams ?? []);
  const allBots = view.groups.flatMap((g) => g.bots ?? []);
  const reply = (data) => send(res, 200, { ok: true, view: 'bots', action: m[1], data });
  const owner = (message) => send(res, 400, { ok: false, error: 'invalid_input', message });
  if (m[1] === 'deleteTeam') {
    if (body.confirm !== true) return send(res, 400, { ok: false, error: 'invalid_input' }), true;
    const t = allTeams.find((x) => x.id === body.teamId);
    if (!t) return owner('그런 팀이 없어요'), true;
    deleted.add(t.id);
    return reply({ teamId: t.id, name: t.name, removedBots: t.members.length }), true;
  }
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
