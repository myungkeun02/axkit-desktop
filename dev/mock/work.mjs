// §28 하고 있는 일 (server 53ea11e): read-only view `work` {title, message, active[], recent[]}; §31 adds kind 'bot' and `parent`.
// /dev/work?empty=1 clears it; /dev/work brings the sample back.

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const sample = () => ({
  title: '하고 있는 일',
  active: [
    { id: 'dev:job_1a2b3c4d', kind: 'dev', title: 'myungkeun02/ax-kit: 파서 고치기', status: 'running', phase: '테스트 중', startedAt: ago(12), updatedAt: ago(1), elapsedMinutes: 12, origin: { channelId: 'channel.app', address: 'owner' } },
    { id: 'browser_77aa', kind: 'browser', title: '코레일 내일 아침 KTX 예매', status: 'waiting', phase: '로그인 단계에서 멈춤', startedAt: ago(30), updatedAt: ago(5), elapsedMinutes: 30, origin: { channelId: 'channel.app' } },
    // §31: 'ax 개선' handed out sub-jobs (kind dev, "하위 작업 · …"), and a bot was given one with its own sub-job.
    { id: 'dev:job_ax01', kind: 'dev', title: 'ax 개선: 결재 카드 정리', status: 'running', phase: '하위 작업 나누는 중', startedAt: ago(25), updatedAt: ago(1), elapsedMinutes: 25, origin: { channelId: 'channel.app', address: 'owner' } },
    { id: 'dev:job_ax01a', kind: 'dev', title: '하위 작업 · 카드 문구 바꾸기', status: 'running', phase: '코드 고치는 중', parent: 'dev:job_ax01', startedAt: ago(10), updatedAt: ago(1), elapsedMinutes: 10, origin: { channelId: 'channel.app', address: 'owner' } },
    { id: 'dev:job_ax01b', kind: 'dev', title: '하위 작업 · 테스트 추가', status: 'queued', parent: 'dev:job_ax01', startedAt: ago(10), updatedAt: ago(10), elapsedMinutes: 10 },
    { id: 'bot_task_7', kind: 'bot', title: '개발 봇 · 로그인 오류 원인 찾기', status: 'running', phase: '로그 읽는 중', startedAt: ago(6), updatedAt: ago(1), elapsedMinutes: 6, origin: { channelId: 'channel.app', address: 'bot:dev' } },
    { id: 'errand_1', kind: 'errand', title: '강남역 근처 저녁 식당 찾기', status: 'queued', startedAt: ago(2), updatedAt: ago(2), elapsedMinutes: 2 },
  ],
  recent: [
    { id: 'bot_task_6', kind: 'bot', title: '디자인 봇 · 아이콘 시안 3개', status: 'done', summary: '시안 3개를 문서에 올렸어요.', startedAt: ago(90), updatedAt: ago(40), elapsedMinutes: 50, origin: { channelId: 'channel.app', address: 'bot:design' } },
    { id: 'dev:job_ax00a', kind: 'dev', title: '하위 작업 · 오래된 설정 지우기', status: 'done', parent: 'dev:job_ax01', startedAt: ago(24), updatedAt: ago(15), elapsedMinutes: 9 },
    { id: 'browser_9f8e7d6c', kind: 'browser', title: '가격 알아보기', status: 'done', summary: "브라우저 심부름 '가격 알아보기'을(를) 마쳤어요. 가장 싼 곳은 12,900원이에요.", link: 'https://example.com/item', startedAt: ago(200), updatedAt: ago(160), elapsedMinutes: 40 },
    { id: 'dev:job_0f0f', kind: 'dev', title: 'myungkeun02/ax-kit-ios: 위젯 고치기', status: 'interrupted', summary: '서버가 다시 켜지면서 멈췄어요.', link: 'feature/widget-fix', startedAt: ago(600), updatedAt: ago(500), elapsedMinutes: 100, origin: { channelId: 'channel.app' } },
    { id: 'dev:job_0e0e', kind: 'dev', title: 'myungkeun02/ax-kit: 테스트 정리', status: 'failed', summary: '테스트 2개가 실패해서 멈췄어요.', startedAt: ago(900), updatedAt: ago(850), elapsedMinutes: 50 },
  ],
});
let work = sample();

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const views = json.views ?? [];
  return { ...json, views: views.some((v) => v.name === 'work') ? views : [...views, { name: 'work', version: 1, actions: [] }] };
}

export function devReset(params = new URLSearchParams()) {
  work = params.get('empty') === '1' ? { title: '하고 있는 일', active: [], recent: [] } : sample();
}

export async function handle({ req, res, path, send }) {
  if (req.method !== 'GET' || path !== 'views/work') return false;
  send(res, 200, { ok: true, view: 'work', version: 1, data: { ...work, message: '' } });
  return true;
}
