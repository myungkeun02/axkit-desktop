// §29 사람: the people the owner told the assistant about ("김민수 대표님은 우리 회사 대표야"), one card each.
// The owner can fix a card's 직함·회사·관계·메모 here; deleting or merging cards is done by talking.

export interface Person {
  key: string;
  name: string;
  names: string[];
  title?: string;
  company?: string;
  relation?: string;
  note?: string;
  emails: number;
  lastSeen?: string;
  openCommitments: number;
  updatedAt?: string;
}

export const EDIT_FIELDS = ['title', 'company', 'relation', 'note'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];
export type PersonForm = Record<EditField, string>;
/** §29: the Mac refuses (400) anything longer. */
export const FIELD_MAX: Record<EditField, number> = { title: 40, company: 60, relation: 80, note: 400 };

export const PEOPLE_EMPTY = "대화에서 사람을 소개하면 여기에 카드가 생겨요. 예: '김민수 님은 우리 회사 대표야'";
export const DELETE_BY_TALKING = '카드를 지우거나 두 사람을 합치려면 대화로 말해 주세요. 예: "이수진 카드 지워 줘"';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function decodePerson(v: unknown): Person | null {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const key = str(o.key);
  const name = str(o.name);
  if (!key || !name) return null;
  const names = Array.isArray(o.names) ? o.names.map(str).filter((n): n is string => !!n) : [];
  return {
    key, name, names: names.length ? names : [name],
    title: str(o.title), company: str(o.company), relation: str(o.relation), note: str(o.note),
    emails: count(o.emails), lastSeen: str(o.lastSeen), openCommitments: count(o.openCommitments), updatedAt: str(o.updatedAt),
  };
}

export function decodePeople(data: unknown): Person[] {
  const o = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  return (Array.isArray(o.people) ? o.people : []).map(decodePerson).filter((p): p is Person => p !== null);
}

/** "대표 · 에이컴퍼니" */
export function roleLine(p: Person): string {
  return [p.title, p.company].filter(Boolean).join(' · ');
}

/** Search by any name the owner uses, the company or the relation (spaces and case ignored). */
export function matchesPerson(p: Person, query: string): boolean {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return true;
  return [p.name, ...p.names, p.company, p.relation, p.title].some((s) => !!s && s.replace(/\s+/g, '').toLowerCase().includes(q));
}

export function formOf(p: Person): PersonForm {
  return { title: p.title ?? '', company: p.company ?? '', relation: p.relation ?? '', note: p.note ?? '' };
}

/** Only the changed boxes go to the Mac; a box emptied by the owner goes as "" (clears it). */
export function editBody(p: Person, form: PersonForm): { key: string } & Partial<PersonForm> {
  const before = formOf(p);
  const body: { key: string } & Partial<PersonForm> = { key: p.key };
  for (const f of EDIT_FIELDS) {
    const v = f === 'note' ? form[f].replace(/\s+$/g, '').replace(/^\s+/, '') : form[f].trim();
    if (v !== before[f]) body[f] = v;
  }
  return body;
}
