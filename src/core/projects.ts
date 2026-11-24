// §23 프로젝트 가져오기 (feature `projects`): which projects the first look reads, grouped by company. The owner picks,
// renames and moves them here; the screen keeps a local draft and sends the whole picked list on save.

export interface ProjectRow {
  path: string;
  display: string;
  name: string;
  company: string;
  remote?: string;
  /** Missing: picked before but no longer found (it can only be unpicked). */
  lastActive?: string;
  claude: number;
  codex: number;
  picked: boolean;
}

export type ScanStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed';
export interface ScanState {
  status: ScanStatus | string;
  phase?: string;
  counts?: Partial<Record<'files' | 'repos' | 'docs' | 'sessions' | 'drive' | 'summarized' | 'signals', number>>;
  finishedAt?: string;
}

export interface ProjectsView {
  companies: { name: string; projects: ProjectRow[] }[];
  picked: number;
  scan: ScanState;
}

export interface Draft {
  /** In the server's order (companies newest first, projects newest first inside). */
  rows: ProjectRow[];
}

export const NAME_MAX = 80;
export const SAVE_MAX = 200;

function num(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function str(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v : undefined; }

/** Tolerant read of `GET views/projects`. */
export function decodeProjects(raw: unknown): ProjectsView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const companies = Array.isArray(r.companies) ? r.companies : [];
  const out: ProjectsView['companies'] = [];
  for (const c of companies) {
    const cc = (c ?? {}) as Record<string, unknown>;
    const name = str(cc.name) ?? '';
    const projects: ProjectRow[] = [];
    for (const p of Array.isArray(cc.projects) ? cc.projects : []) {
      const pp = (p ?? {}) as Record<string, unknown>;
      const path = str(pp.path);
      if (!path) continue;
      projects.push({
        path, display: str(pp.display) ?? path, name: str(pp.name) ?? path.split('/').pop() ?? path, company: str(pp.company) ?? name,
        remote: str(pp.remote), lastActive: str(pp.lastActive), claude: num(pp.claude), codex: num(pp.codex), picked: pp.picked === true,
      });
    }
    out.push({ name, projects });
  }
  const s = (r.scan ?? {}) as Record<string, unknown>;
  return {
    companies: out,
    picked: num(r.picked),
    scan: { status: str(s.status) ?? 'idle', phase: str(s.phase), counts: (s.counts && typeof s.counts === 'object' ? s.counts : {}) as ScanState['counts'], finishedAt: str(s.finishedAt) },
  };
}

export function draftOf(v: ProjectsView): Draft {
  return { rows: v.companies.flatMap((c) => c.projects.map((p) => ({ ...p }))) };
}

/** Companies as the draft has them now: the server's order first, a company the owner made up at the end. */
export function companiesOf(d: Draft): { name: string; projects: ProjectRow[]; picked: number }[] {
  const order: string[] = [];
  for (const r of d.rows) if (!order.includes(r.company)) order.push(r.company);
  return order.map((name) => {
    const projects = d.rows.filter((r) => r.company === name);
    return { name, projects, picked: projects.filter((p) => p.picked).length };
  });
}

const patch = (d: Draft, f: (r: ProjectRow) => ProjectRow): Draft => ({ rows: d.rows.map(f) });

export const pick = (d: Draft, path: string, on: boolean) => patch(d, (r) => (r.path === path ? { ...r, picked: on } : r));
export const pickCompany = (d: Draft, company: string, on: boolean) => patch(d, (r) => (r.company === company && (r.lastActive || !on) ? { ...r, picked: on } : r));
export const renameProject = (d: Draft, path: string, name: string) => patch(d, (r) => (r.path === path ? { ...r, name: name.trim() } : r));
export const moveProject = (d: Draft, path: string, company: string) => patch(d, (r) => (r.path === path ? { ...r, company: company.trim() } : r));
/** Renaming onto an existing company merges the two. */
export const renameCompany = (d: Draft, from: string, to: string) => patch(d, (r) => (r.company === from ? { ...r, company: to.trim() } : r));

/** Why a name can't be used, or null. */
export function nameProblem(name: string): string | null {
  const t = name.trim();
  if (!t) return '이름을 써 주세요.';
  if (t.length > NAME_MAX) return `이름은 ${NAME_MAX}자까지예요.`;
  return null;
}

/** The body of `POST views/projects/save`: every picked project. */
export function saveBody(d: Draft, rescan: boolean): { projects: { path: string; name: string; company: string }[]; rescan: boolean } {
  return { projects: d.rows.filter((r) => r.picked).map((r) => ({ path: r.path, name: r.name, company: r.company })), rescan };
}

/** Something differs from what the server has. */
export function changed(d: Draft, v: ProjectsView): boolean {
  const before = new Map(draftOf(v).rows.map((r) => [r.path, r]));
  return d.rows.some((r) => {
    const b = before.get(r.path);
    return !b || b.picked !== r.picked || (r.picked && (b.name !== r.name || b.company !== r.company));
  });
}

/** After a refresh: the new list, keeping what the owner changed but did not save yet. */
export function mergeDraft(d: Draft, fresh: ProjectsView, old: ProjectsView): Draft {
  const before = new Map(draftOf(old).rows.map((r) => [r.path, r]));
  const mine = new Map(d.rows.map((r) => [r.path, r]));
  return {
    rows: draftOf(fresh).rows.map((r) => {
      const b = before.get(r.path), m = mine.get(r.path);
      if (!m || !b) return r;
      return { ...r, picked: m.picked !== b.picked ? m.picked : r.picked, name: m.name !== b.name ? m.name : r.name, company: m.company !== b.company ? m.company : r.company };
    }),
  };
}

const PHASE: Record<string, string> = {
  local: '이 맥의 폴더를 읽는 중',
  projects: '프로젝트를 읽는 중',
  drive: 'Google Drive를 읽는 중',
  signals: '메일·일정에서 단서를 찾는 중',
  profile: '알아낸 것을 정리하는 중',
  done: '마무리하는 중',
};
const COUNT: [keyof NonNullable<ScanState['counts']>, string][] = [
  ['repos', '저장소'], ['files', '파일'], ['docs', '문서'], ['sessions', '대화 기록'], ['drive', 'Drive 파일'], ['summarized', '요약'], ['signals', '단서'],
];

/** One line for the top of the screen. */
export function scanTitle(s: ScanState): string {
  switch (s.status) {
    case 'running': return (s.phase && PHASE[s.phase]) || '읽는 중';
    case 'paused': return '읽다가 잠시 멈췄어요';
    case 'failed': return '읽다가 막혔어요';
    case 'done': return '다 읽었어요';
    default: return '아직 읽지 않았어요';
  }
}

/** "저장소 4 · 파일 1,203 · 대화 기록 58" (zeros left out). */
export function scanCounts(s: ScanState): string {
  return COUNT.filter(([k]) => (s.counts?.[k] ?? 0) > 0).map(([k, label]) => `${label} ${(s.counts![k] ?? 0).toLocaleString('ko-KR')}`).join(' · ');
}

/** "Claude 대화 12 · Codex 대화 3", or null when there are none. */
export function sessionsLine(p: ProjectRow): string | null {
  const parts = [p.claude ? `Claude 대화 ${p.claude}` : null, p.codex ? `Codex 대화 ${p.codex}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
