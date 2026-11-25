// The evening "답을 기다리는 메일" note (server e727962): a numbered list, "N번 ○○님께 답장 쓰기" buttons, and what happens next.
// /dev/digest posts the note through the iOS mock (/dev/notice) and this extension puts the buttons on it; a tap
// (POST messages {choice: "draft:…"}) becomes the owner's line with the button's label, as the Mac does.
// Reload the page after /dev/digest: the live stream passes the note through without its buttons.

const UP = 47796;
const TEXT = [
  '답을 기다리는 메일이 3통 있어요.',
  '1) 김민수님 — 11월 납품 견적을 오늘 안에 받고 싶어 해요 (1일 전)',
  '2) 이수진님 — 다음 주 미팅 시간을 골라 달래요 (2일 전)',
  '3) 이준호님 — 계약서 수정본을 확인해 달래요 (3일 전)',
  '답장할 메일을 고르면 초안을 써서 먼저 보여 드릴게요. 보내기 전에는 꼭 다시 물어봐요. 답이 필요 없으면 그냥 두셔도 돼요.',
].join('\n');
const CHOICES = [
  { id: 'draft:mail-1', label: '1번 김민수님께 답장 쓰기' },
  { id: 'draft:mail-2', label: '2번 이수진님께 답장 쓰기' },
  { id: 'draft:mail-3', label: '3번 이준호님께 답장 쓰기' },
];

export async function devDigest() {
  await fetch(`http://127.0.0.1:${UP}/dev/notice?kind=digest&text=${encodeURIComponent(TEXT)}`);
}

const withChoices = (e) => (e?.type === 'notice' && e.text === TEXT ? { ...e, choices: CHOICES } : e);

export async function augment({ path, json }) {
  if (path !== 'events' || !json?.ok) return json;
  if (Array.isArray(json.events)) return { ...json, events: json.events.map(withChoices) };
  if (Array.isArray(json.data?.events)) return { ...json, data: { ...json.data, events: json.data.events.map(withChoices) } };
  return json;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function handle({ req, res, path, send }) {
  if (req.method !== 'POST' || path !== 'messages') return false;
  const raw = await readJson(req);
  let body = null;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { /* not JSON: passed on as it is */ }
  const pick = CHOICES.find((c) => c.id === body?.choice);
  // One of ours becomes the owner's line with its label; anything else goes on unchanged, with the Mac's own answer.
  const out = pick ? JSON.stringify({ text: pick.label, ...(body.channel ? { channel: body.channel } : {}), ...(body.clientId ? { clientId: body.clientId } : {}) }) : raw;
  const up = await fetch(`http://127.0.0.1:${UP}${req.url}`, { method: 'POST', headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, body: out });
  send(res, up.status, await up.json());
  return true;
}
