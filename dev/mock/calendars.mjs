// §36 여러 캘린더: views/calendar gains `calendars`, `calendarsLimited`, and events[].calendar / account;
// views/today events gain `calendar`; views/calendar/add takes `calendar` (an id) and answers {id, calendar}.
// /dev/calendars?mode=single  → one calendar (no names, no picker — like an older server)
// /dev/calendars?mode=limited → only the primary, plus calendarsLimited: true
// /dev/calendars?mode=accounts → two Google accounts (events also carry `account`)
// /dev/calendars              → back to the default (three calendars, one read-only)

const UP = 47796;
let mode = 'multi';
const picked = new Map(); // event id → calendar id chosen when it was added

const sets = {
  multi: [
    { id: 'primary', name: '내 캘린더', primary: true, writable: true },
    { id: 'team@group.calendar', name: '팀 일정', primary: false, writable: true, description: '팀 전체가 같이 보는 캘린더' },
    { id: 'ko.south_korea#holiday', name: '대한민국 공휴일', primary: false, writable: false },
  ],
  accounts: [
    { id: 'primary', name: '내 캘린더', primary: true, writable: true, account: 'me@acompany.example' },
    { id: 'home@x', name: '내 캘린더', primary: false, writable: true, account: 'me@home.example' },
    { id: 'team@group.calendar', name: '팀 일정', primary: false, writable: true, account: 'me@acompany.example' },
  ],
  limited: [{ id: 'primary', name: '내 캘린더', primary: true, writable: true }],
  single: [],
};

export function devReset(params = new URLSearchParams()) {
  const m = params.get('mode');
  mode = m && sets[m] ? m : 'multi';
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** Which calendar an upstream event is on: the one picked when it was added, else a stable spread. */
function calendarOf(ev, cals) {
  const id = picked.get(ev.id);
  return cals.find((c) => c.id === id) ?? cals[hash(String(ev.id ?? ev.title)) % cals.length];
}

function tag(ev, cals) {
  if (cals.length < 2) return ev;
  const c = calendarOf(ev, cals);
  return { ...ev, calendar: c.name, ...(mode === 'accounts' && c.account ? { account: c.account } : {}) };
}

export async function augment({ path, json }) {
  if (!json?.ok || !json.data) return json;
  const cals = sets[mode];
  if (path === 'views/calendar' && json.data.days) {
    if (!cals.length) return json;
    return { ...json, data: { ...json.data, calendars: cals, ...(mode === 'limited' ? { calendarsLimited: true } : {}),
      days: json.data.days.map((d) => ({ ...d, events: (d.events ?? []).map((e) => tag(e, cals)) })) } };
  }
  if (path === 'views/today' && Array.isArray(json.data.events)) {
    return { ...json, data: { ...json.data, events: json.data.events.map((e) => tag({ ...e, id: e.id ?? e.title }, cals)) } };
  }
  return json;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export async function handle({ req, res, path, send }) {
  if (req.method !== 'POST' || path !== 'views/calendar/add') return false;
  const body = await readJson(req);
  const cals = sets[mode];
  const want = body.calendar;
  delete body.calendar;
  if (want !== undefined && !cals.some((c) => c.id === want && c.writable)) {
    send(res, 400, { ok: false, error: 'calendar', message: '그 캘린더에는 넣을 수 없어요.' });
    return true;
  }
  const up = await fetch(`http://127.0.0.1:${UP}${req.url}`, {
    method: 'POST', headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await up.json();
  if (!json.ok) { send(res, up.status, json); return true; }
  const cal = cals.find((c) => c.id === want) ?? cals.find((c) => c.primary);
  if (cal) picked.set(json.data.id, cal.id);
  send(res, 200, { ...json, data: { ...json.data, ...(cals.length > 1 && cal ? { calendar: cal.name } : {}) } });
  return true;
}
