// §30 받아쓰기: feature `dictation`, `POST dictation` with the raw recording bytes → {text}.
// The mock does not listen: a recording under 3 KB is "nothing heard", otherwise it returns a fixed sentence
// after 1.5 s. /dev/dictation?fail=503 makes the next answers fail with that status; /dev/dictation clears it.

let fail = 0;

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const features = json.features ?? [];
  return { ...json, features: features.includes('dictation') ? features : [...features, 'dictation'] };
}

export function devReset(params = new URLSearchParams()) {
  fail = Number(params.get('fail') ?? 0) || 0;
}

const WORDS = {
  400: ['too_short', '너무 짧아요. 조금 더 길게 말해 주세요.'],
  413: ['too_long', '너무 길어요. 긴 이야기는 회의 녹음으로 남겨 주세요.'],
  503: ['no_transcriber', '받아쓰기 도구가 꺼져 있어요. 맥에서 받아쓰기를 켜 주세요.'],
  500: ['failed', '받아쓰지 못했어요. 다시 해 주세요.'],
};

export async function handle({ req, res, path, send }) {
  if (req.method !== 'POST' || path !== 'dictation') return false;
  const type = String(req.headers['content-type'] ?? '');
  let size = 0;
  for await (const c of req) size += c.length;
  if (!/^audio\/(mp4|webm|m4a|x-m4a)/.test(type)) { send(res, 400, { ok: false, error: 'shape', message: '녹음 파일이 아니에요.' }); return true; }
  if (size > 12 * 1024 * 1024) { const [error, message] = WORDS[413]; send(res, 413, { ok: false, error, message }); return true; }
  await new Promise((r) => setTimeout(r, 1500));
  if (fail && WORDS[fail]) { const [error, message] = WORDS[fail]; send(res, fail, { ok: false, error, message }); return true; }
  if (size < 3000) { send(res, 200, { ok: true, text: '', message: '말소리를 찾지 못했어요.' }); return true; }
  send(res, 200, { ok: true, text: '내일 오전 열 시에 김민수 대표님이랑 회의 잡아 줘' });
  return true;
}
