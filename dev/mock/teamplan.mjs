// §24 팀 구조 미리보기 (server b085622): feature "team-plan", view {name:"team-plan", actions:[save, apply, decline]}.
// GET views/team-plan → {plan|null}; POST save {teams} (only while proposed, else 400 without message); apply; decline.
// /dev/plan?reset=1 brings the proposal back.

const fresh = () => ({
  id: 'p-mock', createdAt: new Date().toISOString(), status: 'proposed',
  teams: [
    { company: '스튜디오 오름', name: '브랜드A 리뉴얼', purpose: '로고·가이드 개편', kind: 'general',
      roles: [{ title: '레퍼런스 조사', does: '비슷한 사례를 모아요' }, { title: '시안 정리', does: '시안과 피드백을 한 장으로 정리해요' }],
      tasks: ['주간 시안 진행 점검', '클라이언트 피드백 모으기'],
      routines: [{ title: '시안 진행 점검', instruction: '이번 주 시안 진행 상황을 정리해 알려 줘', schedule: { kind: 'weekly', day: 'mon', at: '09:30' } }] },
    { company: '스튜디오 오름', name: '스튜디오 오름 업무', purpose: '견적·일정·정산', kind: 'general',
      roles: [{ title: '견적 정리', does: '견적서와 계약 조건을 챙겨요' }, { title: '일정 관리', does: '마감과 미팅을 챙겨요' }],
      tasks: ['월말 정산'], routines: [{ title: '월말 정산 확인', instruction: '이번 달 받을 돈과 줄 돈을 정리해 줘', schedule: { kind: 'daily', at: '18:00' } }] },
    { company: '개인', name: 'ax-kit', purpose: '개인 비서 서버 개발', kind: 'dev',
      roles: [{ title: '백엔드', does: '서버와 플러그인을 고쳐요' }, { title: '앱', does: 'iOS·데스크톱 앱을 맞춰요' }],
      tasks: [], routines: [{ title: '빌드 확인', instruction: '빌드와 테스트가 깨졌는지 봐 줘', schedule: { kind: 'every', hours: 6 } }] },
  ],
});
let plan = fresh();

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const views = json.views ?? [];
  return {
    ...json,
    features: [...new Set([...(json.features ?? []), 'team-plan'])],
    views: views.some((v) => v.name === 'team-plan') ? views : [...views, { name: 'team-plan', version: 1, actions: ['save', 'apply', 'decline'] }],
  };
}

export function devReset(params = new URLSearchParams()) {
  plan = params.get('none') === '1' ? null : fresh();
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return null; }
}

export async function handle({ req, res, path, send, token, upstream }) {
  if (req.method === 'GET' && path === 'views/team-plan') {
    send(res, 200, { ok: true, view: 'team-plan', version: 1, data: { plan } });
    return true;
  }
  const m = path.match(/^views\/team-plan\/(save|apply|decline)$/);
  if (req.method !== 'POST' || !m) return false;
  const body = (await readJson(req)) ?? {};
  const ok = (data) => send(res, 200, { ok: true, view: 'team-plan', action: m[1], data });
  if (m[1] === 'save') {
    if (!Array.isArray(body.teams) || body.teams.length > 24 || body.teams.some((t) => !t?.name?.trim() || !t?.company?.trim() || (t.roles ?? []).length > 6 || (t.roles ?? []).some((r) => !r?.title?.trim() || r.title.trim().length > 20))) {
      send(res, 400, { ok: false, error: 'shape' });
      return true;
    }
    if (!plan || plan.status !== 'proposed') { send(res, 400, { ok: false, error: 'shape' }); return true; }
    plan = { ...plan, teams: body.teams };
    ok({ saved: body.teams.length });
    return true;
  }
  if (m[1] === 'apply') {
    if (!plan || plan.status !== 'proposed') { ok({ teams: 0, routines: 0 }); return true; }
    const teams = plan.teams.length, routines = plan.teams.reduce((n, t) => n + (t.routines?.length ?? 0), 0);
    plan = { ...plan, status: 'applied', appliedAt: new Date().toISOString() };
    upstream(`/dev/notice?text=${encodeURIComponent(`팀 ${teams}개와 루틴 ${routines}개를 만들었어요.`)}`, token).catch(() => {});
    ok({ teams, routines });
    return true;
  }
  const was = plan?.status === 'proposed';
  if (was) plan = { ...plan, status: 'declined' };
  ok({ declined: was });
  return true;
}
