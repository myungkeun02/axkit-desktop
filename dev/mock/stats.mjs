// Stats additions for the desktop 대시보드 (PROTOCOL-REQUESTS.md D8). Spec example for the server:
//
// 1. views/usage — every `daily[]` row also carries the split it is made of:
//      daily[].byModel: { [model id]: { calls, costUsd } }
//      daily[].byBot:   { [bot id]:   { calls, costUsd } }      (bot ids as in views/bots; "main" = 비서)
//    Sums match the row's own calls/costUsd. Without them the app spreads the period's byModel/byBot shares evenly.
// 2. views/calendar — `done[].team?` (team id from views/bots) so work can be counted per team without a lookup.
// 3. views/approvals — `history: { weeks: [{ week: "YYYY-MM-DD" (Monday, owner time zone), asked, approved, denied,
//      written, auto }] }`, oldest first, 8 weeks. asked = cards opened that week, approved/denied/written = how they
//      were answered (written = answered with a text), auto = actions done by '앞으로는 알아서' rules without a card.
//
// Mock-only filler (not a protocol ask): past months of views/spending are empty in the iOS mock, so they are filled
// with a deterministic scaled copy of this month.

const KST = 9 * 3600_000;
const kstYmd = (t) => new Date(t + KST).toISOString().slice(0, 10);

/** Stable 0..1 from a string (FNV-1a). */
function rand(seed) {
  let h = 0x811c9dc5;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return (h % 10000) / 10000;
}

/** Splits `total` into weights' shares; the last one takes the rounding rest. */
function split(total, weights, digits) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const f = 10 ** digits;
  let left = total;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return Math.round(left * f) / f;
    const v = Math.round(((total * w) / sum) * f) / f;
    left -= v;
    return v;
  });
}

function usage(data) {
  const models = data.byModel ?? [];
  const bots = data.byBot ?? [];
  for (const row of data.daily ?? []) {
    if (models.length) {
      const w = models.map((m) => Math.max(m.costUsd, 0.01) * (0.6 + 0.8 * rand(row.date + m.model)));
      const calls = split(row.calls, w, 0);
      const cost = split(row.costUsd, w, 4);
      row.byModel = Object.fromEntries(models.map((m, i) => [m.model, { calls: calls[i], costUsd: cost[i] }]));
    }
    if (bots.length) {
      const w = bots.map((b) => Math.max(b.costUsd, 0.01) * (0.6 + 0.8 * rand(row.date + b.botId)));
      const calls = split(row.calls, w, 0);
      const cost = split(row.costUsd, w, 4);
      row.byBot = Object.fromEntries(bots.map((b, i) => [b.botId, { calls: calls[i], costUsd: cost[i] }]));
    }
  }
  return data;
}

async function calendar(data, token, upstream) {
  let teams = new Map();
  try {
    const bots = (await upstream('/m/v1/app/views/bots', token)).data;
    teams = new Map(bots.groups.flatMap((g) => g.bots.map((b) => [b.id, b.team])));
  } catch { /* leave without teams */ }
  for (const day of data.days ?? []) for (const d of day.done ?? []) {
    const t = d.bot && teams.get(d.bot.id);
    if (t) d.team = t;
  }
  return data;
}

function approvals(data) {
  const k = new Date(Date.now() + KST);
  const monday = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - ((k.getUTCDay() + 6) % 7) * 86400_000;
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const week = new Date(monday - i * 7 * 86400_000).toISOString().slice(0, 10);
    const r = (s) => rand(week + s);
    const asked = Math.round(8 + 10 * r('a') - (7 - i) * 0.6);
    const denied = Math.round(asked * (0.1 + 0.15 * r('d')));
    const written = Math.round(asked * (0.1 + 0.1 * r('w')));
    const approved = Math.max(0, asked - denied - written);
    // More rules over time → more done without asking, fewer questions.
    const auto = Math.round(10 + (7 - i) * 6 + 8 * r('x'));
    weeks.push({ week, asked, approved, denied, written, auto });
  }
  data.history = { weeks };
  return data;
}

const thisMonth = () => kstYmd(Date.now()).slice(0, 7);

async function spending(data, url, token, upstream) {
  const month = url.searchParams.get('month') ?? thisMonth();
  if (data.total || month >= thisMonth()) return data;
  const current = (await upstream(`/m/v1/app/views/spending?month=${thisMonth()}`, token)).data;
  const scale = 0.75 + 0.5 * rand(month);
  const byCategory = current.byCategory.map((c) => {
    const amount = Math.round((c.amount * scale * (0.6 + 0.8 * rand(month + c.category))) / 100) * 100;
    return { ...c, amount, count: Math.max(1, Math.round(c.count * scale)) };
  }).sort((a, b) => b.amount - a.amount);
  const total = byCategory.reduce((a, c) => a + c.amount, 0);
  return { ...data, total, count: byCategory.reduce((a, c) => a + c.count, 0), byCategory };
}

export async function augment({ path, url, json, token, upstream }) {
  if (!json?.ok || !json.data) return json;
  switch (path) {
    case 'views/usage': json.data = usage(json.data); break;
    case 'views/calendar': json.data = await calendar(json.data, token, upstream); break;
    case 'views/approvals': json.data = approvals(json.data); break;
    case 'views/spending': json.data = await spending(json.data, url, token, upstream); break;
  }
  return json;
}
