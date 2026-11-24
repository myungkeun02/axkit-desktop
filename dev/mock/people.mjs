// §29 사람: view `people` {title, people[]} and action `edit` {key, title?, company?, relation?, note?}.
// /dev/people?empty=1 clears the cards; /dev/people brings the sample back.

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const sample = () => [
  { key: 'p_roh', name: '김민수', names: ['김민수', '김 대표님', '대표님'], title: '대표', company: '에이컴퍼니', relation: '내가 일하는 회사 대표', note: '월요일 오전 회의를 좋아함\n결정이 빠름', emails: 2, lastSeen: ago(60 * 26), openCommitments: 2, updatedAt: ago(15) },
  { key: 'p_lee2', name: '이준호', names: ['이준호'], title: 'CTO', company: '베타랩', relation: '외주 파트너', note: '슬랙보다 메일을 선호', emails: 1, lastSeen: ago(60 * 24 * 5), openCommitments: 0, updatedAt: ago(60 * 30) },
  { key: 'p_lee', name: '이수진', names: ['이수진', '수진 님'], relation: '디자이너 지인', emails: 0, openCommitments: 1, updatedAt: ago(60 * 24 * 9) },
];
let people = sample();

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const views = json.views ?? [];
  return { ...json, views: views.some((v) => v.name === 'people') ? views : [...views, { name: 'people', version: 1, actions: ['edit'] }] };
}

export function devReset(params = new URLSearchParams()) {
  people = params.get('empty') === '1' ? [] : sample();
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

const FIELDS = ['title', 'company', 'relation', 'note'];

export async function handle({ req, res, path, send }) {
  if (req.method === 'GET' && path === 'views/people') {
    send(res, 200, { ok: true, view: 'people', version: 1, data: { title: '사람', people } });
    return true;
  }
  if (req.method !== 'POST' || path !== 'views/people/edit') return false;
  const body = await readJson(req);
  const i = people.findIndex((p) => p.key === body.key);
  if (i < 0) { send(res, 400, { ok: false, error: 'not_found', message: '그런 사람이 없어요.' }); return true; }
  const next = { ...people[i] };
  for (const f of FIELDS) {
    if (typeof body[f] !== 'string') continue;
    const v = body[f].trim();
    const max = { title: 40, company: 60, relation: 80, note: 400 }[f];
    if (v.length > max) { send(res, 400, { ok: false, error: 'shape', message: `너무 길어요. ${max}자 안으로 써 주세요.` }); return true; }
    if (v) next[f] = v; else delete next[f];
  }
  next.updatedAt = new Date().toISOString();
  people = [next, ...people.filter((_, j) => j !== i)];
  send(res, 200, { ok: true, data: { person: next } });
  return true;
}
