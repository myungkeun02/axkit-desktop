// §27 처음 알아보기 (`views/first-look`, feature `first-look`): the progress bar while files are read, then "당신은 이런
// 사람이고, 이런 조직이 필요해 보여요", fixed by talking (`revise {text}`), then built (`apply`). Pure, so it is easy to test.

import type { Schedule } from './teamPlan';

export type LookStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed';
export interface LookPhase { id: string; label: string; done: number; total: number; state: 'waiting' | 'active' | 'done' }
export interface LookRole { title: string; does: string }
export interface LookRoutine { title: string; when: string; schedule?: Schedule }
export interface LookProject { name: string; purpose: string; team?: { kind: 'dev' | 'general'; roles: LookRole[] }; routines: LookRoutine[] }
export interface LookCompany { name: string; relation: string; projects: LookProject[] }
export interface LookResult { about: string; companies: LookCompany[]; plan: { id: string; status: 'proposed' | 'applied' | 'declined' } | null }
export interface FirstLook {
  status: LookStatus;
  phase: string;
  phases: LookPhase[];
  percent: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: LookResult;
}
export interface Revised { text: string; changed: string[]; skipped: string[]; result?: LookResult }

const STATUSES: LookStatus[] = ['idle', 'running', 'paused', 'done', 'failed'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function decodeResult(raw: unknown): LookResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = obj(raw);
  const plan = obj(r.plan);
  return {
    about: str(r.about),
    companies: list(r.companies).map(obj).filter((c) => str(c.name).trim()).map((c) => ({
      name: str(c.name), relation: str(c.relation) || 'employer',
      projects: list(c.projects).map(obj).filter((p) => str(p.name).trim()).map((p) => {
        const team = p.team ? obj(p.team) : null;
        return {
          name: str(p.name), purpose: str(p.purpose),
          team: team ? { kind: team.kind === 'dev' ? 'dev' as const : 'general' as const, roles: list(team.roles).map(obj).filter((x) => str(x.title).trim()).map((x) => ({ title: str(x.title), does: str(x.does) })) } : undefined,
          routines: list(p.routines).map(obj).filter((x) => str(x.title).trim()).map((x) => ({ title: str(x.title), when: str(x.when), schedule: x.schedule as Schedule | undefined })),
        };
      }),
    })),
    plan: str(plan.id) ? { id: str(plan.id), status: plan.status === 'applied' || plan.status === 'declined' ? plan.status : 'proposed' } : null,
  };
}

export function decodeFirstLook(raw: unknown): FirstLook {
  const r = obj(raw);
  const status = STATUSES.includes(r.status as LookStatus) ? (r.status as LookStatus) : 'idle';
  return {
    status, phase: str(r.phase),
    phases: list(r.phases).map(obj).filter((p) => str(p.id)).map((p) => ({
      id: str(p.id), label: str(p.label) || str(p.id), done: num(p.done), total: num(p.total),
      state: p.state === 'active' || p.state === 'done' ? p.state : 'waiting',
    })),
    // The server weighs the phases; only `done` is 100.
    percent: status === 'done' ? 100 : Math.min(Math.max(Math.round(num(r.percent)), 0), 99),
    startedAt: str(r.startedAt) || undefined, finishedAt: str(r.finishedAt) || undefined, error: str(r.error) || undefined,
    result: decodeResult(r.result),
  };
}

export function decodeRevised(raw: unknown): Revised {
  const r = obj(raw);
  return { text: str(r.text), changed: list(r.changed).filter((x): x is string => typeof x === 'string'), skipped: list(r.skipped).filter((x): x is string => typeof x === 'string'), result: decodeResult(r.result) };
}

/** "폴더 파일 120/400 · 프로젝트 문서·대화 기록 12/40" — only phases that have something to read. */
export const countsLine = (f: FirstLook) => f.phases.filter((p) => p.total > 0).map((p) => `${p.label} ${p.done}/${p.total}`).join(' · ');

/** The phase being read now, by its label. */
export const activeLabel = (f: FirstLook) => f.phases.find((p) => p.state === 'active')?.label ?? f.phases.find((p) => p.id === f.phase)?.label;

/** "12분째" while running, "1시간 3분 걸렸어요" when finished. */
export function elapsedLine(f: FirstLook, now = Date.now()): string | null {
  const from = f.startedAt ? Date.parse(f.startedAt) : NaN;
  if (!Number.isFinite(from)) return null;
  const to = f.finishedAt && f.status !== 'running' ? Date.parse(f.finishedAt) : now;
  const m = Math.max(0, Math.floor((to - from) / 60_000));
  const t = m < 1 ? '1분 미만' : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
  return f.status === 'running' ? (m < 1 ? '방금 시작했어요' : `${t}째`) : `${t} 걸렸어요`;
}

export const STATUS_LINE: Record<LookStatus, string> = {
  idle: '아직 알아보지 않았어요',
  running: '파일을 읽고 있어요',
  paused: '멈춰 있어요',
  done: '다 알아봤어요',
  failed: '끝내지 못했어요',
};

export function errorLine(code?: string): string {
  if (!code) return '중간에 문제가 생겼어요. 다시 시작해 주세요.';
  if (code === 'model_unavailable') return 'AI 모델에 닿지 못해 멈췄어요. AI 연결을 확인한 뒤 다시 시작해 주세요.';
  return `중간에 문제가 생겼어요 (${code}). 다시 시작해 주세요.`;
}

export const RELATION: Record<string, string> = { employer: '다니는 곳', own: '내 회사', client: '고객사', partner: '협력사', personal: '개인' };
export const relationLabel = (r: string) => RELATION[r] ?? r;

/** 1–500 characters (§27.2). */
export const REVISE_MAX = 500;
