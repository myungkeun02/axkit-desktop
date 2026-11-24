// §24 팀 구조 미리보기 (feature `team-plan`): the first look proposes company → team → roles (+ routines) and the owner
// edits it here before it is built. Pure data and edits; the screen keeps a draft and sends the whole team list on save.

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Schedule = { kind: 'daily'; at: string } | { kind: 'weekly'; day: Day; at: string } | { kind: 'every'; hours: number };
export interface PlanRole { title: string; does: string }
export interface PlanRoutine { title: string; instruction: string; schedule: Schedule }
export interface PlanTeam {
  company: string;
  name: string;
  purpose: string;
  kind: 'dev' | 'general';
  roles: PlanRole[];
  tasks: string[];
  routines: PlanRoutine[];
}
export type PlanStatus = 'proposed' | 'applied' | 'declined';
export interface TeamPlan { id: string; createdAt: string; status: PlanStatus; appliedAt?: string; teams: PlanTeam[] }

export const LIMITS = { teams: 24, roles: 6, roleTitle: 20, roleDoes: 120, routines: 5, company: 80, name: 60, purpose: 300, routineTitle: 60, instruction: 1000 } as const;
export const DAYS: { id: Day; label: string }[] = [
  { id: 'mon', label: '월' }, { id: 'tue', label: '화' }, { id: 'wed', label: '수' }, { id: 'thu', label: '목' }, { id: 'fri', label: '금' }, { id: 'sat', label: '토' }, { id: 'sun', label: '일' },
];

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function schedule(raw: unknown): Schedule | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.kind === 'daily' && HHMM.test(s(r.at))) return { kind: 'daily', at: s(r.at) };
  if (r.kind === 'weekly' && HHMM.test(s(r.at)) && DAYS.some((d) => d.id === r.day)) return { kind: 'weekly', day: r.day as Day, at: s(r.at) };
  if (r.kind === 'every' && typeof r.hours === 'number' && Number.isInteger(r.hours) && r.hours >= 1 && r.hours <= 24) return { kind: 'every', hours: r.hours };
  return null;
}

function team(raw: unknown): PlanTeam | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!s(r.name).trim() || !s(r.company).trim()) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    company: s(r.company), name: s(r.name), purpose: s(r.purpose), kind: r.kind === 'dev' ? 'dev' : 'general',
    roles: list(r.roles).map((x) => { const o = (x ?? {}) as Record<string, unknown>; return { title: s(o.title), does: s(o.does) }; }).filter((x) => x.title.trim()),
    tasks: list(r.tasks).filter((x): x is string => typeof x === 'string' && !!x.trim()),
    routines: list(r.routines).flatMap((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const sch = schedule(o.schedule);
      return sch && s(o.title).trim() ? [{ title: s(o.title), instruction: s(o.instruction), schedule: sch }] : [];
    }),
  };
}

/** `GET views/team-plan` → the plan, or null when there is none (or it can't be read). */
export function decodePlan(raw: unknown): TeamPlan | null {
  const p = ((raw ?? {}) as Record<string, unknown>).plan;
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  const status = r.status === 'applied' || r.status === 'declined' ? r.status : 'proposed';
  return {
    id: s(r.id), createdAt: s(r.createdAt), status, appliedAt: s(r.appliedAt) || undefined,
    teams: (Array.isArray(r.teams) ? r.teams : []).map(team).filter((t): t is PlanTeam => t !== null),
  };
}

/** Companies in the order they first appear, each with the indexes of its teams. */
export function tree(teams: PlanTeam[]): { company: string; teams: number[] }[] {
  const out: { company: string; teams: number[] }[] = [];
  teams.forEach((t, i) => {
    const c = out.find((x) => x.company === t.company.trim());
    if (c) c.teams.push(i); else out.push({ company: t.company.trim(), teams: [i] });
  });
  return out;
}

export function scheduleLabel(sch: Schedule): string {
  const t = (at: string) => {
    const [h, m] = at.split(':').map(Number);
    return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시${m ? ` ${m}분` : ''}`;
  };
  if (sch.kind === 'daily') return `매일 ${t(sch.at)}`;
  if (sch.kind === 'weekly') return `매주 ${DAYS.find((d) => d.id === sch.day)?.label ?? ''}요일 ${t(sch.at)}`;
  return sch.hours === 24 ? '하루에 한 번' : `${sch.hours}시간마다`;
}

export const kindLabel = (t: PlanTeam) => (t.kind === 'dev' ? '개발팀 · 검수 포함' : '일반 팀');

// ---------- edits (each returns a new list) ----------
const at = (teams: PlanTeam[], i: number, f: (t: PlanTeam) => PlanTeam) => teams.map((t, j) => (j === i ? f(t) : t));

export const removeTeam = (teams: PlanTeam[], i: number) => teams.filter((_, j) => j !== i);
export const editTeam = (teams: PlanTeam[], i: number, patch: Partial<Pick<PlanTeam, 'name' | 'purpose' | 'company'>>) => at(teams, i, (t) => ({ ...t, ...patch }));
/** Renaming a company onto an existing one merges them. */
export const renameCompany = (teams: PlanTeam[], from: string, to: string) => teams.map((t) => (t.company.trim() === from ? { ...t, company: to.trim() } : t));
export const addRole = (teams: PlanTeam[], i: number) => at(teams, i, (t) => (t.roles.length >= LIMITS.roles ? t : { ...t, roles: [...t.roles, { title: '', does: '' }] }));
export const editRole = (teams: PlanTeam[], i: number, r: number, patch: Partial<PlanRole>) => at(teams, i, (t) => ({ ...t, roles: t.roles.map((x, k) => (k === r ? { ...x, ...patch } : x)) }));
export const removeRole = (teams: PlanTeam[], i: number, r: number) => at(teams, i, (t) => ({ ...t, roles: t.roles.filter((_, k) => k !== r) }));
export const editRoutine = (teams: PlanTeam[], i: number, r: number, patch: Partial<PlanRoutine>) => at(teams, i, (t) => ({ ...t, routines: t.routines.map((x, k) => (k === r ? { ...x, ...patch } : x)) }));
export const removeRoutine = (teams: PlanTeam[], i: number, r: number) => at(teams, i, (t) => ({ ...t, routines: t.routines.filter((_, k) => k !== r) }));

/** What stops a save, in the owner's words (first problem only), or null. */
export function planProblem(teams: PlanTeam[]): string | null {
  if (teams.length > LIMITS.teams) return `팀은 ${LIMITS.teams}개까지예요.`;
  for (const t of teams) {
    const where = t.name.trim() || '이름 없는 팀';
    if (!t.name.trim()) return '팀 이름을 써 주세요.';
    if (t.name.trim().length > LIMITS.name) return `'${where}' 팀 이름은 ${LIMITS.name}자까지예요.`;
    if (!t.company.trim()) return `'${where}'의 회사 이름을 써 주세요.`;
    if (t.company.trim().length > LIMITS.company) return `'${where}'의 회사 이름은 ${LIMITS.company}자까지예요.`;
    if (t.purpose.length > LIMITS.purpose) return `'${where}' 목적은 ${LIMITS.purpose}자까지예요.`;
    if (t.roles.length > LIMITS.roles) return `'${where}' 직원은 ${LIMITS.roles}명까지예요.`;
    for (const r of t.roles) {
      if (!r.title.trim()) return `'${where}'에 역할 이름이 빈 직원이 있어요.`;
      if (r.title.trim().length > LIMITS.roleTitle) return `'${where}'의 역할 '${r.title.trim()}'은 ${LIMITS.roleTitle}자까지예요.`;
      if (r.does.length > LIMITS.roleDoes) return `'${where}'의 '${r.title.trim()}' 하는 일은 ${LIMITS.roleDoes}자까지예요.`;
    }
    for (const r of t.routines) {
      if (!r.title.trim() || r.title.length > LIMITS.routineTitle) return `'${where}'의 루틴 제목은 1~${LIMITS.routineTitle}자예요.`;
      if (!r.instruction.trim() || r.instruction.length > LIMITS.instruction) return `'${where}'의 루틴 '${r.title}'에 할 일을 써 주세요(${LIMITS.instruction}자까지).`;
      if (r.schedule.kind !== 'every' && !HHMM.test(r.schedule.at)) return `'${where}'의 루틴 '${r.title}' 시간을 확인해 주세요.`;
    }
  }
  return null;
}

/** The body of `POST views/team-plan/save`: the whole list, trimmed the way the server keeps it. */
export function saveBody(teams: PlanTeam[]): { teams: PlanTeam[] } {
  return {
    teams: teams.map((t) => ({
      ...t, company: t.company.trim(), name: t.name.trim(),
      roles: t.roles.map((r) => ({ title: r.title.trim(), does: r.does })),
      routines: t.routines.map((r) => ({ ...r, title: r.title.trim() })),
    })),
  };
}

export const sameTeams = (a: PlanTeam[], b: PlanTeam[]) => JSON.stringify(saveBody(a)) === JSON.stringify(saveBody(b));

/** "팀 3개와 루틴 2개를 만들었어요." from the apply answer. */
export function appliedLine(r: { teams?: number; routines?: number } | null | undefined): string {
  const teams = r?.teams ?? 0, routines = r?.routines ?? 0;
  if (!teams && !routines) return '이미 만든 제안이에요. 새로 만든 것은 없어요.';
  return `팀 ${teams}개${routines ? `와 루틴 ${routines}개` : ''}를 만들었어요.`;
}

/** A 400 without a sentence ("no proposed plan"): the plan was built or dropped meanwhile. */
export const NOT_PROPOSED = '이 제안은 이미 만들었거나 만들지 않기로 했어요. 화면을 새로 불러올게요.';
