// §22 browser-live for the desktop mock: a fake shop login page waiting to be handed to the owner.
// capabilities: feature "browser-live", view {name:"browser-live", actions:[start,tap,type,key,scroll,back,done]}
// GET views/browser-live → {live, url?, title?, reason?, startedAt?, idleClosesAt?, pending?, closed?, frameUrl, streamUrl}
// GET browser-live/stream (SSE: state, frame{seq,url,title,width,height,jpeg base64}) · GET browser-live/frame (image/jpeg)
// POST views/browser-live/<action>. MOCK_LIVE_STREAM=off refuses the stream (tries the app's fallback). The login button works once both fields were typed into. `curl /dev/live` hands a new page over (`?room=<id>` / `?elsewhere=1` = where the errand came from, `?old=1` = sentence-only reply).
import { readFileSync } from 'node:fs';

const FRAMES = { login: readFileSync(new URL('./live/login.jpg', import.meta.url)), done: readFileSync(new URL('./live/done.jpg', import.meta.url)) };
const W = 824, H = 1720;
let s = fresh();
let seq = 0;
const clients = new Set();
let announced = false;
/** Where the errand came from (`/dev/live?room=<id>` or `?elsewhere=1`): decides `done`'s continuedIn/channel. */
let origin = { kind: 'app' };

function fresh() {
  return { live: false, page: 'login', focus: null, typed: { id: false, pw: false }, startedAt: null, pending: { url: 'https://shop.example.com/login', reason: 'login', at: new Date().toISOString() }, closed: undefined };
}
function stateData() {
  if (!s.live) return { live: false, ...(s.pending ? { pending: s.pending } : {}), ...(s.closed ? { closed: s.closed } : {}) };
  const url = s.page === 'login' ? 'https://shop.example.com/login' : 'https://shop.example.com/cart';
  return { live: true, url, title: s.page === 'login' ? '로그인' : '장바구니', reason: 'login', startedAt: s.startedAt, idleClosesAt: new Date(Date.now() + 15 * 60_000).toISOString() };
}
function frame() {
  const d = stateData();
  return { seq: ++seq, url: d.url, title: d.title, width: W, height: H, jpeg: FRAMES[s.page].toString('base64') };
}
function broadcast(event, data) {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return undefined; }
}

export async function augment({ path, json, upstream }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  if (!announced) {
    announced = true;
    // The assistant's hand-over reply with the `live` field (server 6b40592+), so the chat shows the "브라우저 화면 열기" button.
    upstream('/dev/browser?reason=login', '').catch(() => {});
  }
  const views = json.views ?? [];
  return {
    ...json,
    features: [...new Set([...(json.features ?? []), 'browser-live'])],
    views: views.some((v) => v.name === 'browser-live') ? views : [...views, { name: 'browser-live', version: 1, actions: ['start', 'tap', 'type', 'key', 'scroll', 'back', 'done'] }],
  };
}

export async function handle({ req, res, path, send, token, upstream, upstreamPost }) {
  if (req.method === 'GET' && path === 'views/browser-live') {
    send(res, 200, { ok: true, view: 'browser-live', version: 1, data: { ...stateData(), frameUrl: 'browser-live/frame', streamUrl: 'browser-live/stream' } });
    return true;
  }
  if (req.method === 'GET' && path === 'browser-live/stream') {
    // MOCK_LIVE_STREAM=off: the stream always fails, to try the app's 2-second picture fallback.
    if (process.env.MOCK_LIVE_STREAM === 'off') { send(res, 503, { ok: false }); return true; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(stateData())}\n\n`);
    if (s.live) res.write(`event: frame\ndata: ${JSON.stringify(frame())}\n\n`);
    clients.add(res);
    const keep = setInterval(() => res.write(': keepalive\n\n'), 25_000);
    req.on('close', () => { clients.delete(res); clearInterval(keep); });
    return true;
  }
  if (req.method === 'GET' && path === 'browser-live/frame') {
    if (!s.live) { send(res, 404, { ok: false }); return true; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': FRAMES[s.page].length });
    res.end(FRAMES[s.page]);
    return true;
  }
  const m = path.match(/^views\/browser-live\/(start|tap|type|key|scroll|back|done)$/);
  if (req.method !== 'POST' || !m) return false;
  const body = (await readJson(req)) ?? {};
  const action = m[1];
  const ok = (data) => send(res, 200, { ok: true, view: 'browser-live', action, data });
  const closedMsg = () => send(res, 400, { ok: false, error: 'shape', message: '브라우저 화면이 닫혀 있어요. 비서에게 다시 열어 달라고 해 주세요.' });
  if (action === 'start') {
    if (!s.live && !s.pending) { send(res, 400, { ok: false, error: 'shape', message: '지금 열어 드릴 브라우저 화면이 없어요.' }); return true; }
    if (!s.live) Object.assign(s, { live: true, pending: undefined, closed: undefined, startedAt: new Date().toISOString(), page: 'login' });
    broadcast('state', stateData()); broadcast('frame', frame());
    ok(stateData());
    return true;
  }
  if (action === 'done') {
    const resumed = s.live || !!s.pending;
    s = { ...fresh(), pending: undefined, closed: 'done' };
    broadcast('state', stateData());
    const line = '(앱의 브라우저 화면에서 직접 마쳤어요: shop.example.com) 계속해 주세요.';
    let where = {};
    if (resumed && origin.kind === 'elsewhere') {
      upstream(`/dev/notice?text=${encodeURIComponent('브라우저 화면에서 마친 일은 디스코드 대화에서 이어 갈게요.')}`, '').catch(() => {});
      where = { continuedIn: 'elsewhere' };
    } else if (resumed) {
      upstreamPost('/m/v1/app/messages', token, { text: line, ...(origin.room ? { channel: origin.room } : {}) }).catch(() => {});
      where = { continuedIn: 'app', ...(origin.room ? { channel: origin.room } : {}) };
    }
    ok({ ...stateData(), resumed, ...where });
    return true;
  }
  if (!s.live) { closedMsg(); return true; }
  if (action === 'tap') {
    if (typeof body.x !== 'number' || typeof body.y !== 'number') { send(res, 400, { ok: false, error: 'shape' }); return true; }
    const y = body.y;
    if (s.page === 'login') {
      if (y >= 410 && y <= 520) s.focus = 'id';
      else if (y >= 620 && y <= 730) s.focus = 'pw';
      else if (y >= 800 && y <= 920 && s.typed.id && s.typed.pw) { s.page = 'done'; broadcast('frame', frame()); broadcast('state', stateData()); }
      else s.focus = null;
    }
  } else if (action === 'type') {
    if (typeof body.text !== 'string' || !body.text || body.text.length > 1000) { send(res, 400, { ok: false, error: 'shape' }); return true; }
    if (s.focus) s.typed[s.focus] = true;   // the text itself is never kept or logged
  } else if (action === 'key') {
    const keys = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(body.name)) { send(res, 400, { ok: false, error: 'shape' }); return true; }
    if (body.name === 'Tab') s.focus = s.focus === 'id' ? 'pw' : 'id';
    if (body.name === 'Enter' && s.page === 'login' && s.typed.id && s.typed.pw) { s.page = 'done'; broadcast('frame', frame()); broadcast('state', stateData()); }
  } else if (action === 'scroll') {
    if (typeof body.dy !== 'number') { send(res, 400, { ok: false, error: 'shape' }); return true; }
  } else if (action === 'back') {
    if (s.page === 'done') { s.page = 'login'; broadcast('frame', frame()); broadcast('state', stateData()); }
  }
  ok({ accepted: true });
  return true;
}

/** `GET /dev/live` (no auth): hand a new page over (like a paused browser task). */
export function devReset(params = new URLSearchParams(), upstream) {
  s = fresh();
  origin = params.get('elsewhere') ? { kind: 'elsewhere' } : { kind: 'app', room: params.get('room') ?? undefined };
  // A new hand-over reply: with `live` (new server), or `?old=1` the sentence only (older server).
  if (upstream && params.get('reply') !== '0') upstream(`/dev/browser?reason=login${params.get('old') ? '&old=1' : ''}`, '').catch(() => {});
  broadcast('state', stateData());
}
