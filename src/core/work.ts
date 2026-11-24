// §28 하고 있는 일 (`views/work`, skill.work): long tasks (개발 작업, 브라우저 심부름, 생활 심부름) run in the background;
// the answer comes later as a `notice` with a work `kind`. Pure decoding and words, so it is easy to test.

export type WorkStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'interrupted';

export interface WorkItem {
  id: string;
  kind: string;
  title: string;
  status: WorkStatus;
  phase?: string;
  /** Read from a page, maybe: shown as text only, never as a link or a command (§28.1). */
  summary?: string;
  link?: string;
  startedAt?: string;
  updatedAt?: string;
  elapsedMinutes?: number;
  /** The room that asked for it, when known. */
  room?: string;
  /** §31: the `id` of the job that handed this one out (shown indented under it). */
  parent?: string;
}

export interface WorkView { title: string; active: WorkItem[]; recent: WorkItem[] }

const STATUSES: WorkStatus[] = ['queued', 'running', 'waiting', 'done', 'failed', 'interrupted'];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

/** §28 origin `{channelId:"channel.app", address:"owner"|"bot:<room>"}`: the main chat or that bot's room.
 *  Anything else is another channel (Discord…) the app can't open. */
function roomOf(channel?: string, address?: string): string | undefined {
  if (channel !== 'channel.app') return undefined;
  if (address?.startsWith('bot:')) return address.slice('bot:'.length) || '';
  return '';
}

function item(raw: unknown): WorkItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id), title = str(r.title);
  if (!id || !title) return null;
  const status = STATUSES.includes(r.status as WorkStatus) ? (r.status as WorkStatus) : 'running';
  const origin = (r.origin ?? {}) as Record<string, unknown>;
  const channel = str(origin.channelId);
  return {
    id, title, status, kind: str(r.kind) ?? 'other',
    phase: str(r.phase), summary: str(r.summary), link: str(r.link), startedAt: str(r.startedAt), updatedAt: str(r.updatedAt),
    elapsedMinutes: typeof r.elapsedMinutes === 'number' && Number.isFinite(r.elapsedMinutes) ? Math.max(0, Math.round(r.elapsedMinutes)) : undefined,
    room: roomOf(channel, str(origin.address)),
    parent: str(r.parent),
  };
}

export function decodeWork(raw: unknown): WorkView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(item).filter((x): x is WorkItem => x !== null) : []);
  return { title: str(r.title) ?? '하고 있는 일', active: list(r.active), recent: list(r.recent) };
}

export const STATUS_LABEL: Record<WorkStatus, string> = {
  queued: '차례 기다리는 중', running: '하는 중', waiting: '직접 하실 단계', done: '끝남', failed: '못 끝냄', interrupted: '중간에 멈춤',
};

/** Unknown kinds (처음 알아보기, 루틴… later) show as is. */
export function kindLabel(kind: string): string {
  return ({ dev: '개발 작업', browser: '브라우저 심부름', errand: '생활 심부름', bot: '봇에게 맡긴 일' } as Record<string, string>)[kind] ?? kind;
}

/** "12분째", "1시간 5분째" (running), "40분 걸림" (finished). */
export function elapsedLabel(w: WorkItem): string | null {
  const m = w.elapsedMinutes;
  if (m === undefined) return null;
  const t = m < 1 ? '1분 미만' : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
  return w.status === 'running' || w.status === 'waiting' || w.status === 'queued' ? (m < 1 ? '방금 시작' : `${t}째`) : `${t} 걸림`;
}

/** `link` is a page, a branch or a PR: only https pages open in the browser; the rest is text to copy. */
export const openableLink = (link?: string) => (link && /^https:\/\//.test(link) ? link : null);

/** §28: notices that carry a work result read like the assistant talking, with a small label. */
export const WORK_NOTICE: Record<string, string> = {
  'dev.job': '개발 작업', 'browser.task': '브라우저 심부름', 'errands.task': '생활 심부름', 'work.interrupted': '멈춘 일',
};
export const workNoticeLabel = (kind?: string) => (kind ? WORK_NOTICE[kind] : undefined);

export const isRunning = (w: WorkItem) => w.status === 'queued' || w.status === 'running' || w.status === 'waiting';

export interface PanelRow { item: WorkItem; depth: number }
export interface PanelRows { running: PanelRow[]; finished: PanelRow[]; runningCount: number }

/** §31 작업 패널: jobs still going on top, the last few finished below. A job handed out by another sits under it
 *  (indented); a parent that finished stays on top while any of its sub-jobs still runs. */
export function panelRows(view: WorkView | null, finishedMax = 5): PanelRows {
  if (!view) return { running: [], finished: [], runningCount: 0 };
  const all = new Map<string, WorkItem>();
  for (const w of [...view.active, ...view.recent]) if (!all.has(w.id)) all.set(w.id, w);
  const children = new Map<string, WorkItem[]>();
  const roots: WorkItem[] = [];
  for (const w of all.values()) {
    // A parent we don't know (or a loop back to itself) makes it a top-level row.
    if (w.parent && w.parent !== w.id && all.has(w.parent)) {
      const list = children.get(w.parent) ?? [];
      list.push(w);
      children.set(w.parent, list);
    } else roots.push(w);
  }
  const busy = new Map<string, boolean>();
  const anyRunning = (w: WorkItem, seen = new Set<string>()): boolean => {
    if (busy.has(w.id)) return busy.get(w.id)!;
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    const b = isRunning(w) || (children.get(w.id) ?? []).some((c) => anyRunning(c, seen));
    busy.set(w.id, b);
    return b;
  };
  const order = (list: WorkItem[]) => [...list].sort((a, b) => Number(anyRunning(b)) - Number(anyRunning(a)));
  const walk = (w: WorkItem, depth: number, out: PanelRow[], seen: Set<string>) => {
    if (seen.has(w.id)) return;
    seen.add(w.id);
    out.push({ item: w, depth });
    for (const c of order(children.get(w.id) ?? [])) walk(c, Math.min(depth + 1, 3), out, seen);
  };
  const running: PanelRow[] = [];
  const finished: PanelRow[] = [];
  const seen = new Set<string>();
  for (const r of roots.filter((w) => anyRunning(w))) walk(r, 0, running, seen);
  // A loop of parents (a → b → a) has no top: show those on their own rather than lose them.
  for (const w of all.values()) if (!seen.has(w.id) && isRunning(w)) walk(w, 0, running, seen);
  for (const r of roots.filter((w) => !anyRunning(w)).slice(0, finishedMax)) walk(r, 0, finished, seen);
  return { running, finished, runningCount: [...all.values()].filter(isRunning).length };
}
