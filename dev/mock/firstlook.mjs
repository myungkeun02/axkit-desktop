// §27 처음 알아보기 (server 53ea11e): feature "first-look", view {name:"first-look", actions:[revise, apply, start]}.
// /dev/firstlook?state=idle|running|done resets it. Running moves forward on each GET and finishes after ~12 reads.

let state = 'running', reads = 0, startedAt = new Date(Date.now() - 12 * 60_000).toISOString(), finishedAt = null, plan = 'proposed';
let companies = [
  { name: '에이컴퍼니', relation: 'employer', projects: [
    { name: '베타랩', purpose: '학습 플랫폼', team: { kind: 'dev', roles: [{ title: '개발', does: '기능을 만들어요' }, { title: '운영', does: '배포와 장애를 챙겨요' }] },
      routines: [{ title: '주간 점검', when: '매주 월 09:00', schedule: { kind: 'weekly', day: 'mon', at: '09:00' } }] },
    { name: '감마랩', purpose: '코드 리뷰 도구', team: { kind: 'dev', roles: [{ title: '개발', does: '' }] }, routines: [] },
  ] },
  { name: '개인', relation: 'personal', projects: [{ name: 'ax-kit', purpose: '개인 비서', team: { kind: 'dev', roles: [{ title: '백엔드', does: '' }] }, routines: [] }] },
];

function view() {
  if (state === 'running' && ++reads > 12) { state = 'done'; finishedAt = new Date().toISOString(); }
  const k = Math.min(reads / 12, 1);
  const phases = [
    { id: 'local', label: '폴더 파일', done: Math.round(400 * Math.min(k * 2, 1)), total: 400, state: k >= 0.5 ? 'done' : 'active' },
    { id: 'projects', label: '프로젝트 문서·대화 기록', done: Math.round(40 * Math.max(0, Math.min((k - 0.5) * 2.5, 1))), total: 40, state: k >= 0.9 ? 'done' : k >= 0.5 ? 'active' : 'waiting' },
    { id: 'drive', label: '드라이브', done: 0, total: 0, state: k >= 0.9 ? 'done' : 'waiting' },
    { id: 'signals', label: '메일·일정', done: 0, total: 0, state: k >= 0.9 ? 'done' : 'waiting' },
    { id: 'profile', label: '정리', done: k >= 1 ? 1 : 0, total: 1, state: k >= 1 ? 'done' : k >= 0.9 ? 'active' : 'waiting' },
  ];
  const result = state === 'done' ? { about: '개발자 겸 운영자. 에이컴퍼니 커뮤니티를 운영해요.', companies, plan: plan ? { id: 'p-mock', status: plan } : null } : undefined;
  return {
    status: state, phase: phases.find((p) => p.state === 'active')?.id ?? 'done', phases, counts: { files: phases[0].done },
    percent: state === 'done' ? 100 : Math.round(k * 95), startedAt: state === 'idle' ? null : startedAt, ...(finishedAt ? { finishedAt } : {}),
    ...(result ? { result } : {}),
  };
}

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const views = json.views ?? [];
  return {
    ...json,
    features: [...new Set([...(json.features ?? []), 'first-look'])],
    views: views.some((v) => v.name === 'first-look') ? views : [...views, { name: 'first-look', version: 1, actions: ['revise', 'apply', 'start'] }],
  };
}

export function devReset(params = new URLSearchParams()) {
  state = params.get('state') ?? 'running';
  reads = state === 'done' ? 12 : 0;
  startedAt = new Date(Date.now() - 12 * 60_000).toISOString();
  finishedAt = state === 'done' ? new Date().toISOString() : null;
  plan = 'proposed';
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export async function handle({ req, res, path, send }) {
  if (req.method === 'GET' && path === 'views/first-look') { send(res, 200, { ok: true, view: 'first-look', version: 1, data: view() }); return true; }
  const m = path.match(/^views\/first-look\/(revise|apply|start)$/);
  if (req.method !== 'POST' || !m) return false;
  const body = await readJson(req);
  const ok = (data) => send(res, 200, { ok: true, view: 'first-look', action: m[1], data });
  if (m[1] === 'start') {
    if (state !== 'running') { state = 'running'; reads = 0; startedAt = new Date().toISOString(); finishedAt = null; }
    ok({ scan: 'started' });
    return true;
  }
  if (plan !== 'proposed') { send(res, 400, { ok: false, error: 'shape', message: '고칠 팀 구조 제안이 없어요. 이미 만들었거나 만들지 않기로 했어요.' }); return true; }
  if (m[1] === 'apply') { plan = 'applied'; ok({ teams: 3, routines: 1 }); return true; }
  const text = String(body.text ?? '');
  if (/따로/.test(text)) {
    const acompany = companies[0];
    const eb = acompany.projects.find((p) => p.name === '베타랩');
    if (eb) {
      companies = [{ ...acompany, projects: acompany.projects.filter((p) => p.name !== '베타랩') }, { name: '베타랩', relation: 'own', projects: [eb] }, ...companies.slice(1)];
      ok({ text: '이렇게 바꿨어요: 베타랩 → 베타랩 (따로 나눔).', changed: ['베타랩 → 베타랩 (따로 나눔)'], skipped: [], result: view().result });
      return true;
    }
  }
  ok({ text: '바꿀 것을 찾지 못했어요. 회사나 프로젝트 이름을 넣어 다시 말해 주세요.', changed: [], skipped: [], result: view().result });
  return true;
}
