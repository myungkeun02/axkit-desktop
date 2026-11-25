// §34 드라이브: a ui:"blocks" view whose rows carry `message` — pressing a row asks the assistant in chat.
// §38: rows with `query` reopen the view with it — "📁 폴더로 보기" {mode:"tree"} → 내 드라이브 / 공유 문서함 →
// folders {mode, source, folder, path} → files (message). The first text block is the path.

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

const TREE = {
  my: { label: '내 드라이브', folders: { root: ['기획', '영상', '계약'], 기획: ['2026 상반기'], 영상: [], 계약: [], '2026 상반기': [] },
    files: { root: ['분기 보고서.pdf'], 기획: ['회의록 11월.docx', '신메뉴 기획안.pptx'], 영상: ['11월 촬영 목록.xlsx'], 계약: ['외주 계약서.pdf'], '2026 상반기': ['목표.docx'] } },
  shared: { label: '공유 문서함', folders: { root: ['베타랩 공유'], '베타랩 공유': [] }, files: { root: ['예산안.xlsx'], '베타랩 공유': ['제안서.pdf'] } },
};

function treeView(q) {
  const send = (blocks) => ({ ok: true, view: 'drive', version: 1, data: { title: '드라이브', blocks } });
  if (!q.get('source')) {
    return send([
      { kind: 'text', text: '📁 드라이브' },
      { kind: 'list', title: '어디를 볼까요?', rows: Object.entries(TREE).map(([id, t]) => ({ title: t.label, query: { mode: 'tree', source: id, folder: 'root', path: t.label } })) },
    ]);
  }
  const src = TREE[q.get('source')];
  const folder = q.get('folder') ?? 'root';
  const path = q.get('path') ?? src.label;
  const folders = (src.folders[folder] ?? []).map((f) => ({ title: f, detail: '폴더', query: { mode: 'tree', source: q.get('source'), folder: f, path: `${path} › ${f}` } }));
  const files = (src.files[folder] ?? []).map((f) => ({ title: f, detail: '파일', message: `드라이브의 "${f}" 내용을 요약해 줘` }));
  return send([
    { kind: 'text', text: `📁 ${path}` },
    { kind: 'list', title: '폴더와 파일', rows: [...folders, ...files] },
    ...(folders.length + files.length === 0 ? [{ kind: 'note', text: '빈 폴더예요.' }] : []),
    { kind: 'list', rows: [{ title: '처음 화면으로', query: {} }] },
  ]);
}

export async function handle({ req, res, path, url, send }) {
  if (req.method !== 'GET' || path !== 'views/drive') return false;
  if (url.searchParams.get('mode') === 'tree') { send(res, 200, treeView(url.searchParams)); return true; }
  send(res, 200, { ok: true, view: 'drive', version: 1, data: { title: '드라이브', blocks: [
    { kind: 'list', rows: [{ title: '📁 폴더로 보기', detail: '내 드라이브·공유 문서함을 폴더별로', query: { mode: 'tree' } }] },
    { kind: 'text', text: '최근에 바뀐 파일이에요. 누르면 비서가 내용을 요약해요.' },
    { kind: 'list', title: '최근 파일', rows: [
      ...files.map((f) => ({ ...f, message: `드라이브의 "${f.title}" 내용을 요약해 줘` })),
      { title: '공유 폴더', detail: '누를 수 없는 줄', trailing: '12개' },
    ] },
  ] } });
  return true;
}
