// §23 프로젝트 가져오기 (server 1cbb913): feature "projects", view {name:"projects", actions:[save, refresh]}.
// GET views/projects[?refresh=1], POST views/projects/save {projects:[{path,name,company}], rescan}, POST views/projects/refresh {}.
// Mock-only: a pretend scan that runs through its phases in ~40 seconds after "저장하고 바로 읽기".

const HOME = '/Users/me';
const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const FOUND = [
  { path: `${HOME}/dev/acompany/web`, name: 'acompany-web', company: '에이컴퍼니', remote: 'github.com/acompany/acompany-web', lastActive: days(0.2), claude: 12, codex: 3 },
  { path: `${HOME}/dev/acompany/api`, name: 'acompany-api', company: '에이컴퍼니', remote: 'github.com/acompany/acompany-api', lastActive: days(2), claude: 4, codex: 0 },
  { path: `${HOME}/dev/acompany/admin`, name: 'acompany-admin', company: '에이컴퍼니', lastActive: days(40), claude: 0, codex: 1 },
  { path: `${HOME}/work/hanbit/shop`, name: 'shop', company: '한빛상사', remote: 'github.com/hanbit/shop', lastActive: days(1), claude: 7, codex: 2 },
  { path: `${HOME}/work/hanbit/erp-bridge`, name: 'erp-bridge', company: '한빛상사', lastActive: days(9), claude: 2, codex: 0 },
  { path: `${HOME}/dev/ax-kit`, name: 'ax-kit', company: '개인', remote: 'github.com/me/ax-kit', lastActive: days(0.05), claude: 58, codex: 6 },
  { path: `${HOME}/dev/blog`, name: 'blog', company: '개인', lastActive: days(120), claude: 1, codex: 0 },
];
const LATER = { path: `${HOME}/dev/acompany/mobile`, name: 'acompany-mobile', company: '에이컴퍼니', remote: 'github.com/acompany/acompany-mobile', lastActive: days(0.01), claude: 1, codex: 0 };

let found = [...FOUND];
let picked = [
  { path: `${HOME}/dev/acompany/web`, name: 'acompany-web', company: '에이컴퍼니' },
  { path: `${HOME}/dev/ax-kit`, name: 'ax-kit', company: '개인' },
  { path: `${HOME}/old/side-project`, name: 'side-project', company: '개인' },
];
let scan = { status: 'idle', phase: 'local', counts: { files: 0, repos: 0, docs: 0, sessions: 0, drive: 0, summarized: 0, signals: 0 } };
let timer = null;

const display = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

function data() {
  const chosen = new Map(picked.map((p) => [p.path, p]));
  const rows = found.map((c) => { const m = chosen.get(c.path); return { ...c, display: display(c.path), name: m?.name ?? c.name, company: m?.company ?? c.company, picked: !!m }; });
  for (const p of picked) if (!found.some((c) => c.path === p.path)) rows.push({ path: p.path, display: display(p.path), name: p.name, company: p.company, claude: 0, codex: 0, picked: true });
  const last = (r) => (r.lastActive ? Date.parse(r.lastActive) : 0);
  const order = [...new Set(rows.map((r) => r.company))].sort((a, b) => Math.max(...rows.filter((r) => r.company === b).map(last)) - Math.max(...rows.filter((r) => r.company === a).map(last)));
  return {
    companies: order.map((name) => ({ name, projects: rows.filter((r) => r.company === name).sort((a, b) => last(b) - last(a)) })),
    picked: rows.filter((r) => r.picked).length,
    scan: { ...scan, counts: { ...scan.counts } },
  };
}

function startScan() {
  if (scan.status === 'running') return 'running';
  const phases = ['local', 'projects', 'drive', 'signals', 'profile'];
  let i = 0;
  scan = { status: 'running', phase: 'local', counts: { files: 0, repos: 0, docs: 0, sessions: 0, drive: 0, summarized: 0, signals: 0 } };
  timer = setInterval(() => {
    const c = scan.counts;
    c.files += 410; c.repos = picked.length; c.docs += 6; c.sessions += 9; if (i >= 2) c.drive += 12; if (i >= 1) c.summarized += 3; if (i >= 3) c.signals += 2;
    i += 1;
    if (i >= phases.length * 2) { clearInterval(timer); scan = { ...scan, status: 'done', phase: 'done', finishedAt: new Date().toISOString() }; return; }
    scan.phase = phases[Math.floor(i / 2)];
  }, 4_000);
  return 'started';
}

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const views = json.views ?? [];
  return {
    ...json,
    features: [...new Set([...(json.features ?? []), 'projects'])],
    views: views.some((v) => v.name === 'projects') ? views : [...views, { name: 'projects', version: 1, actions: ['save', 'refresh'] }],
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return null; }
}

export async function handle({ req, res, path, url, send }) {
  const ok = (d, action) => send(res, 200, { ok: true, view: 'projects', ...(action ? { action } : { version: 1 }), data: d });
  if (req.method === 'GET' && path === 'views/projects') {
    if (url.searchParams.get('refresh') === '1' && !found.includes(LATER)) found = [LATER, ...found];
    ok(data());
    return true;
  }
  if (req.method === 'POST' && path === 'views/projects/refresh') {
    if (!found.includes(LATER)) found = [LATER, ...found];
    ok(data(), 'refresh');
    return true;
  }
  if (req.method === 'POST' && path === 'views/projects/save') {
    const body = await readJson(req);
    const list = Array.isArray(body?.projects) ? body.projects : null;
    const good = (s) => typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 80;
    if (!list || list.length > 200 || !list.every((p) => typeof p?.path === 'string' && good(p.name) && good(p.company))) {
      send(res, 400, { ok: false, error: 'shape' });
      return true;
    }
    const known = new Set([...found.map((c) => c.path), ...picked.map((p) => p.path)]);
    if (list.some((p) => !known.has(p.path))) {
      send(res, 400, { ok: false, error: 'shape', message: '찾은 목록에 없는 폴더예요. 목록을 새로 고친 뒤 골라 주세요.' });
      return true;
    }
    picked = [...new Map(list.map((p) => [p.path, { path: p.path, name: p.name.trim(), company: p.company.trim() }])).values()];
    const started = body.rescan === true ? startScan() : undefined;
    ok({ saved: picked.length, ...(started ? { scan: started } : {}) }, 'save');
    return true;
  }
  return false;
}
