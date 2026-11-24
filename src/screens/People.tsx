import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { errorText } from '../core/api';
import { clock, relative } from '../core/format';
import {
  decodePeople, decodePerson, DELETE_BY_TALKING, editBody, FIELD_MAX, formOf, matchesPerson, PEOPLE_EMPTY, roleLine,
  type EditField, type Person, type PersonForm,
} from '../core/people';
import { Button, CardHeader, Empty, Icon, Panel, Spinner } from '../ui/kit';

/** §29 사람: cards for the people the owner told the assistant about. Every room reads them, so "대표님" is never asked again. */
export function PeopleScreen() {
  const { session } = useApp();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    try { setPeople(decodePeople(await session.api.view('people'))); setProblem(null); }
    catch (e) { setProblem(errorText(e)); }
  };
  useEffect(() => { void load(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (people ?? []).filter((p) => matchesPerson(p, query)), [people, query]);

  if (!people) {
    return <div className="center-fill">{problem ? <Empty title="불러오지 못했어요" message={problem}><Button kind="secondary" onClick={() => void load()}>다시 해 보기</Button></Empty> : <Spinner />}</div>;
  }
  if (people.length === 0) {
    return <div className="center-fill"><Empty icon={Icon.person} title="아직 카드가 없어요" message={PEOPLE_EMPTY}><Button kind="secondary" onClick={() => void load()}>새로 보기</Button></Empty></div>;
  }
  const saved = (p: Person) => {
    setPeople((list) => (list ? [p, ...list.filter((x) => x.key !== p.key)] : [p]));
    setEditing(null);
  };
  return (
    <div className="people">
      <div className="people-bar">
        <input className="field" placeholder="이름·회사·관계로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="사람 찾기" />
        <Button kind="secondary" small onClick={() => void load()}>새로 보기</Button>
      </div>
      {shown.length === 0 && <div className="secondary people-none">'{query.trim()}'에 맞는 사람이 없어요.</div>}
      <div className="people-list">
        {shown.map((p) => (editing === p.key
          ? <PersonEditor key={p.key} person={p} onSaved={saved} onCancel={() => setEditing(null)} />
          : <PersonCard key={p.key} person={p} onEdit={() => setEditing(p.key)} />))}
      </div>
      <div className="footnote people-foot">{DELETE_BY_TALKING}</div>
    </div>
  );
}

function PersonCard({ person: p, onEdit }: { person: Person; onEdit: () => void }) {
  const role = roleLine(p);
  const also = p.names.filter((n) => n !== p.name);
  return (
    <Panel className="person">
      <CardHeader title={p.name} subtitle={role || undefined} right={<Button kind="secondary" small onClick={onEdit}>고치기</Button>} />
      {also.length > 0 && <div className="footnote">이렇게도 불러요: {also.join(', ')}</div>}
      {p.relation && <div className="person-relation">{p.relation}</div>}
      {p.note && <div className="person-note selectable">{p.note.split('\n').filter((l) => l.trim()).map((l, i) => <div key={i}>{l}</div>)}</div>}
      <div className="person-meta footnote">
        {p.openCommitments > 0 && <span className="chip">열린 약속 {p.openCommitments}개</span>}
        {p.emails > 0 && <span>메일 주소 {p.emails}개</span>}
        {p.lastSeen && <span title={clock(p.lastSeen)}>마지막 연락 {relative(p.lastSeen)}</span>}
        <span className="grow" />
        {p.updatedAt && <span title={clock(p.updatedAt)}>{relative(p.updatedAt)} 고침</span>}
      </div>
    </Panel>
  );
}

const LABELS: Record<EditField, string> = { title: '직함·역할', company: '회사', relation: '나와의 관계', note: '메모' };
const HINTS: Record<EditField, string> = { title: '예: 대표', company: '예: 에이컴퍼니', relation: '예: 내가 일하는 회사 대표', note: '특징을 한 줄씩. 예: 결정이 빠름' };

function PersonEditor({ person, onSaved, onCancel }: { person: Person; onSaved: (p: Person) => void; onCancel: () => void }) {
  const { session } = useApp();
  const [form, setForm] = useState<PersonForm>(formOf(person));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const body = editBody(person, form);
  const changed = Object.keys(body).length > 1;

  const save = async () => {
    if (!changed) { onCancel(); return; }
    setBusy(true); setProblem(null);
    try {
      const r = await session.api.viewAction<{ person?: unknown }>('people', 'edit', body);
      onSaved(decodePerson(r?.person) ?? { ...person, ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v || undefined])), key: person.key, updatedAt: new Date().toISOString() });
    } catch (e) {
      setProblem(errorText(e, '고치지 못했어요. 다시 해 주세요.'));
      setBusy(false);
    }
  };

  const field = (f: EditField) => (
    <label key={f} className="person-field">
      <span className="footnote">{LABELS[f]}</span>
      {f === 'note'
        ? <textarea className="field" rows={3} value={form[f]} placeholder={HINTS[f]} maxLength={FIELD_MAX.note} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
        : <input className="field" value={form[f]} placeholder={HINTS[f]} maxLength={FIELD_MAX[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } else if (e.key === 'Escape') onCancel(); }} />}
    </label>
  );

  return (
    <Panel className="person editing">
      <CardHeader title={person.name} subtitle="비운 칸은 카드에서 지워져요." />
      <div className="person-form">{(['title', 'company', 'relation', 'note'] as const).map(field)}</div>
      {problem && <div className="footnote" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{problem}</div>}
      <div className="person-actions">
        <Button kind="secondary" small disabled={busy} onClick={onCancel}>취소</Button>
        <Button kind="primary" small busy={busy} disabled={!changed} onClick={() => void save()}>저장</Button>
      </div>
    </Panel>
  );
}
