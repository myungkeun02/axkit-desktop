// Bot role prompts (ax-kit APP-PROTOCOL §16), for the desktop mock.
// views/bots → bots[].instructions (≤1500) + instructionsBy "default"|"ai"|"owner"
// POST views/bots/setInstructions {botId, text|null} → {botId, instructions, instructionsBy}
//   text null = back to the default. Text that would skip 결재 or hides orders for the AI → 400 with a plain `message`.

const saved = new Map(); // botId → { text, by }

function defaultFor(bot) {
  const team = (bot.name ?? '').replace(/ (팀장|직원 \d+|검수)$/, '');
  if (bot.rank === 'lead') return `${team}팀의 팀장이에요. 맡은 일을 나눠 직원에게 주고, 결과를 모아 비서에게 쉬운 말로 알려요. 돈이 들거나 밖으로 보내는 일은 결재를 올려요.`;
  if (bot.rank === 'reviewer') return `${team}팀의 검수예요. 팀이 만든 결과를 직접 확인하고, 문제가 있으면 무엇이 왜 문제인지 한 줄로 팀장에게 알려요.`;
  if (bot.rank === 'staff') return `${team}팀의 직원이에요. 팀장이 준 일을 끝까지 하고, 막히면 바로 팀장에게 물어요.`;
  return bot.role ?? '';
}

function current(bot) {
  return saved.get(bot.id) ?? { text: defaultFor(bot), by: bot.rank === 'lead' ? 'ai' : 'default' };
}

const LOOSENS = /(결재|확인|승인)\s*(없이|안\s*받고|건너뛰|생략)|묻지\s*말고|자동\s*결제/;
const HIDDEN = /(ignore (all|previous)|system prompt|이전 지시를? 무시)/i;

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export async function augment({ path, json }) {
  if (!json || json.ok === false) return json;
  if (path === 'capabilities') {
    return { ...json, views: (json.views ?? []).map((v) => (v.name === 'bots' && !(v.actions ?? []).includes('setInstructions') ? { ...v, actions: [...(v.actions ?? []), 'setInstructions'] } : v)) };
  }
  if (path === 'views/bots' && json.data?.groups) {
    const groups = json.data.groups.map((g) => ({ ...g, bots: (g.bots ?? []).map((b) => { const c = current(b); return { ...b, instructions: c.text, instructionsBy: c.by }; }) }));
    return { ...json, data: { ...json.data, groups } };
  }
  return json;
}

export async function handle({ req, path, token, send, res, upstream }) {
  if (req.method !== 'POST' || path !== 'views/bots/setInstructions') return false;
  const body = await readJson(req);
  const bots = (await upstream('/m/v1/app/views/bots', token)).data?.groups?.flatMap((g) => g.bots ?? []) ?? [];
  const bot = bots.find((b) => b.id === body.botId);
  if (!bot || (body.text !== null && typeof body.text !== 'string')) { send(res, 400, { ok: false, error: 'shape', message: '그런 봇이 없어요' }); return true; }
  if (body.text === null) {
    saved.delete(bot.id);
    send(res, 200, { ok: true, view: 'bots', action: 'setInstructions', data: { botId: bot.id, instructions: defaultFor(bot), instructionsBy: 'default' } });
    return true;
  }
  const text = body.text.trim().slice(0, 1500);
  const reason = LOOSENS.test(text) ? '결재 없이 하라는 내용은 넣을 수 없어요. 보내기·결제·삭제는 늘 확인을 받아요.'
    : HIDDEN.test(text) ? 'AI에게 내리는 숨은 지시처럼 보이는 줄이 있어요.'
    : text.length < 10 ? '조금 더 자세히 적어 주세요.' : null;
  if (reason) { send(res, 400, { ok: false, error: 'shape', message: reason }); return true; }
  saved.set(bot.id, { text, by: 'owner' });
  send(res, 200, { ok: true, view: 'bots', action: 'setInstructions', data: { botId: bot.id, instructions: text, instructionsBy: 'owner' } });
  return true;
}
