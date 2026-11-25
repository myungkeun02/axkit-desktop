// §38 (1e7cd61) 메일: a blocks view `mail` (feature `mail-screen`) — mail the assistant read in the last 3 days.
// Rows carry `message` (tapping asks what to do with that mail in chat).

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const features = json.features ?? [];
  const views = json.views ?? [];
  return {
    ...json,
    features: features.includes('mail-screen') ? features : [...features, 'mail-screen'],
    views: views.some((v) => v.name === 'mail') ? views : [...views, { name: 'mail', version: 1, ui: 'blocks', title: '메일', icon: 'envelope' }],
  };
}

const row = (from, subject, kind, what) => ({ title: `${from} — ${subject}`, detail: `${kind} · ${what}`, message: `${from}님의 "${subject}" 메일 어떻게 할까요?` });

export async function handle({ req, res, path, send }) {
  if (req.method !== 'GET' || path !== 'views/mail') return false;
  send(res, 200, { ok: true, view: 'mail', version: 1, data: { title: '메일', blocks: [
    { kind: 'stat', title: '최근 3일 비서가 읽은 메일', value: '14통' },
    { kind: 'list', title: '먼저 보실 메일 · 2통', rows: [row('김민수', '11월 납품 견적', '질문', '오늘 안에 견적을 받고 싶어 해요'), row('이준호', '계약서 수정본', '문서 요청', '수정본 확인을 부탁해요')] },
    { kind: 'list', title: '알아 두면 좋은 메일 · 1통', rows: [row('이수진', '다음 주 미팅', '일정', '화·목 중 고르면 돼요')] },
    { kind: 'note', text: '광고·알림 메일 11통은 개수만 셌어요.' },
  ] } });
  return true;
}
