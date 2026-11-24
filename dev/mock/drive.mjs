// §34 드라이브: a ui:"blocks" view whose rows carry `message` — pressing a row asks the assistant in chat.

const files = [
  { title: '분기 보고서.pdf', detail: '어제 · 2.1MB' },
  { title: '회의록 11월.docx', detail: '3일 전' },
  { title: '예산안.xlsx', detail: '지난주' },
];

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const views = json.views ?? [];
  return { ...json, views: views.some((v) => v.name === 'drive') ? views : [...views, { name: 'drive', version: 1, ui: 'blocks', title: '드라이브' }] };
}

export async function handle({ req, res, path, send }) {
  if (req.method !== 'GET' || path !== 'views/drive') return false;
  send(res, 200, { ok: true, view: 'drive', version: 1, data: { title: '드라이브', blocks: [
    { kind: 'text', text: '최근에 바뀐 파일이에요. 누르면 비서가 내용을 요약해요.' },
    { kind: 'list', title: '최근 파일', rows: [
      ...files.map((f) => ({ ...f, message: `드라이브의 "${f.title}" 내용을 요약해 줘` })),
      { title: '공유 폴더', detail: '누를 수 없는 줄', trailing: '12개' },
    ] },
  ] } });
  return true;
}
