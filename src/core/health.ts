// 상태 점검 (view `health`), two server shapes:
//   ax-hq (§7.6): {checkedAt, summary?, checks:[{id,label,status:"ok"|"warn"|"fail"|"error",detail?,group?}]}
//   ax-kit (§5.6): {checkedAt, findings:[{id,area,ok,line,fix?}]}

export type HealthStatus = 'ok' | 'warn' | 'error';
export interface HealthCheck { id: string; label: string; status: HealthStatus; detail?: string; fix?: string }
export interface Health { checkedAt?: string; summary?: string; checks: HealthCheck[] }

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const RANK: Record<HealthStatus, number> = { error: 0, warn: 1, ok: 2 };

export function healthOf(raw: unknown): Health {
  const d = obj(raw);
  let checks: HealthCheck[] = [];
  if (Array.isArray(d.checks)) {
    checks = d.checks.map((c) => obj(c)).filter((c) => str(c.id)).map((c) => {
      const s = c.status;
      const status: HealthStatus = s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : 'error';
      // Command output arrives with column padding ("node    v24"); ax-hq also says which part a check belongs to.
      return { id: c.id as string, label: (str(c.label) ?? (c.id as string)).replace(/\s{2,}/g, ' '), status, detail: [str(c.detail), str(c.group)].filter(Boolean).join(' · ') || undefined, fix: str(c.fix) };
    });
  } else if (Array.isArray(d.findings)) {
    checks = d.findings.map((f) => obj(f)).filter((f) => str(f.id)).map((f) => ({
      // ax-kit's `area` is an internal id ("switch", "notice"); its `line` is the plain sentence, so that is the label.
      id: f.id as string, label: str(f.line) ?? str(f.area) ?? (f.id as string), status: f.ok === true ? 'ok' : 'warn', fix: str(f.fix),
    }));
  }
  checks.sort((a, b) => RANK[a.status] - RANK[b.status]);
  return { checkedAt: str(d.checkedAt), summary: str(d.summary), checks };
}

export const problems = (h: Health) => h.checks.filter((c) => c.status !== 'ok');

/** What goes to the assistant when the owner asks it to fix things. */
export function fixRequest(h: Health): string {
  const list = problems(h).map((c) => `- ${c.label}${c.detail ? `: ${c.detail}` : ''}`).join('\n');
  return `[상태 점검] 아래 문제를 고쳐 주세요. 고칠 수 없는 건 어떻게 하면 되는지 알려 주세요.\n${list}`;
}
