import { useState } from 'react';
import { WorkPanel } from './WorkPanel';
import { useApp } from '../app/context';
import { errorText, hasFeature, viewActions } from '../core/api';
import { botFor, groupForMeeting, RANK_LABEL, teamFor, teamMembers, TIERS, type Bot, type BotsView, type Rank, type Team, type Tier } from '../core/views';
import { BotAvatar } from '../ui/BotAvatar';
import { Button, CardHeader, List, Panel, Row, Segmented, Sheet, Switch } from '../ui/kit';
import { Banners } from './Banners';
import { canEdit, EDIT_MAX, editBotBody, moveTargets, renameTeamBody } from '../core/botEdit';
import { ChatRoom, ordinalOf } from './Chat';

/** A team, meeting or (older server) bot room: conversation in the middle, team settings on the right. */
export function RoomScreen({ room }: { room: string }) {
  const { session } = useApp();
  const team = teamFor(session.bots, room);
  const meeting = groupForMeeting(session.bots, room);
  const bot = botFor(session.bots, room);
  const [settings, setSettings] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const canMeet = viewActions(session.capabilities, 'bots').includes('meeting');
  const members = team ? teamMembers(session.bots, team) : [];
  const working = members.some((m) => m.status === 'working') || bot?.status === 'working';
  const title = meeting ? `${meeting.label} 팀장회의` : team?.name ?? bot?.name ?? session.roomTitle(room);

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          {team ? <Faces bots={session.bots} ids={members.map((m) => m.id)} /> : !meeting && bot ? <BotAvatar name={bot.name} size={26} avatar={bot.avatar} status={bot.status} ordinal={ordinalOf(session.bots, room)} /> : null}
          <span>{title}</span>
          {working && <span className="footnote" style={{ fontWeight: 400 }}>일하는 중</span>}
        </h1>
        <div className="side right">
          {meeting && canMeet && <button className="pill-btn" onClick={() => setMeetingOpen(true)}>회의 열기</button>}
          {team && <button className={`pill-btn${settings ? ' on' : ''}`} onClick={() => setSettings(!settings)} aria-pressed={settings}>팀 설정</button>}
        </div>
      </header>
      <Banners />
      <div className="split">
        <div className="split-main"><ChatRoom key={room} room={room} /></div>
        {!(team && settings) && <WorkPanel />}
        {team && settings && (
          <aside className="side-pane scroll" aria-label="팀 설정">
            <TeamSettings team={team} onClose={() => setSettings(false)} />
          </aside>
        )}
      </div>
      {meeting && meetingOpen && <MeetingSheet groupId={meeting.id} label={meeting.label} onClose={() => setMeetingOpen(false)} />}
    </>
  );
}

/** Stacked faces of a team (lead first). */
export function Faces({ bots, ids, size = 24, max = 4 }: { bots: BotsView | null; ids: string[]; size?: number; max?: number }) {
  const list = (bots?.groups ?? []).flatMap((g) => g.bots);
  const shown = ids.slice(0, max).map((id) => list.find((b) => b.id === id)).filter(Boolean);
  return (
    <span className="faces" style={{ height: size }}>
      {shown.map((b, i) => (
        <span key={b!.id} className="face" style={{ marginLeft: i ? -size * 0.35 : 0, zIndex: max - i }}>
          <BotAvatar name={b!.name} size={size} avatar={b!.avatar} status={i === 0 ? b!.status : undefined} ordinal={ordinalOf(bots, b!.id)} />
        </span>
      ))}
    </span>
  );
}

function TeamSettings({ team, onClose }: { team: Team; onClose: () => void }) {
  const { session } = useApp();
  const members = teamMembers(session.bots, team);
  const canSet = viewActions(session.capabilities, 'bots').includes('setTiers');
  const canInstruct = viewActions(session.capabilities, 'bots').includes('setInstructions') || members.some((m) => m.instructions !== undefined);
  const edits = canEdit(viewActions(session.capabilities, 'bots'));
  const canOpen = canInstruct || edits.editBot || edits.moveBot;
  const [open, setOpen] = useState<string | null>(null);
  const roles = (['lead', 'staff', 'reviewer'] as Rank[]).filter((r) => members.some((m) => m.rank === r));
  const tierOf = (r: Rank) => members.find((m) => m.rank === r)?.tier;
  const setTier = async (rank: Rank, tier: Tier) => {
    try {
      await session.api.viewAction('bots', 'setTiers', { teamId: team.id, tiers: { [rank]: tier } });
      session.say(`${RANK_LABEL[rank]} 등급을 ${tier}(으)로 바꿨어요`);
      await session.refreshBasics();
    } catch (e) { session.say(errorText(e)); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <TeamName team={team} editable={edits.renameTeam} onClose={onClose} />
      {team.decidedBy === 'ai' && (
        <div className="note-box">AI가 정한 구성이에요{team.reason ? ` — ${team.reason}` : ''}</div>
      )}
      <Panel tight>
        <CardHeader title={`팀원 ${members.length}명`} />
        <List>
          {members.map((m) => (
            <div key={m.id}>
              <Row title={<span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BotAvatar name={m.name} size={30} avatar={m.avatar} status={m.status} ordinal={ordinalOf(session.bots, m.id)} />{m.name}</span>}
                detail={[m.rank ? RANK_LABEL[m.rank] : null, m.statusText].filter(Boolean).join(' · ')}
                trailing={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {m.tier && <span className="tier-badge">{m.tier}</span>}
                  {canOpen && <span className="footnote">{open === m.id ? '접기' : edits.editBot || edits.moveBot ? '고치기' : '일하는 방식'}</span>}
                </span>}
                onClick={canOpen ? () => setOpen(open === m.id ? null : m.id) : undefined} />
              {open === m.id && (edits.editBot || edits.moveBot) && <MemberEdit key={m.id} bot={m} team={team} canRename={edits.editBot} canMove={edits.moveBot} onMoved={() => setOpen(null)} />}
              {open === m.id && canInstruct && <Instructions bot={m} />}
            </div>
          ))}
        </List>
      </Panel>
      {canSet && roles.length > 0 && (
        <Panel tight>
          <CardHeader title="역할별 AI 등급" subtitle="S가 가장 똑똑하고 비싸요. C는 싸고 빨라요." />
          <List>
            {roles.map((r) => (
              <Row key={r} title={RANK_LABEL[r]} trailing={<TierPicker value={tierOf(r)} onChange={(t) => void setTier(r, t)} label={`${RANK_LABEL[r]} 등급`} />} />
            ))}
          </List>
        </Panel>
      )}
    </div>
  );
}

/** The team's name and what it does; 고치기 edits both in place (§37 renameTeam, applied at once). */
function TeamName({ team, editable, onClose }: { team: Team; editable: boolean; onClose: () => void }) {
  const { session } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [purpose, setPurpose] = useState(team.purpose ?? '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const begin = () => { setName(team.name); setPurpose(team.purpose ?? ''); setProblem(null); setEditing(true); };
  const save = async () => {
    const r = renameTeamBody(team, name, purpose);
    if ('problem' in r) { setProblem(r.problem); return; }
    setSaving(true); setProblem(null);
    try {
      await session.api.viewAction('bots', 'renameTeam', r.body);
      await session.refreshBasics();
      session.say('팀 이름을 바꿨어요');
      setEditing(false);
    } catch (e) { setProblem(errorText(e)); }
    setSaving(false);
  };
  if (!editing) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>{team.name}</div>
          {editable && <button className="btn plain small" onClick={begin}>고치기</button>}
          <button className="btn plain small" onClick={onClose}>닫기</button>
        </div>
        {team.purpose && <div className="secondary">{team.purpose}</div>}
      </>
    );
  }
  return (
    <Panel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className="footnote" htmlFor="team-name">팀 이름</label>
        <input id="team-name" className="field" value={name} maxLength={EDIT_MAX.name} autoFocus onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); if (e.key === 'Escape') setEditing(false); }} />
        <label className="footnote" htmlFor="team-purpose">하는 일</label>
        <textarea id="team-purpose" className="field" rows={2} value={purpose} maxLength={EDIT_MAX.purpose} onChange={(e) => setPurpose(e.target.value)} />
        {problem && <div className="footnote red" role="alert">{problem}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button kind="primary" small busy={saving} disabled={!name.trim()} onClick={() => void save()}>저장</Button>
          <Button kind="secondary" small disabled={saving} onClick={() => setEditing(false)}>취소</Button>
        </div>
      </div>
    </Panel>
  );
}

/** A member's name and role, and moving them to another team (§37 editBot / moveBot, applied at once). */
function MemberEdit({ bot, team, canRename, canMove, onMoved }: { bot: Bot; team: Team; canRename: boolean; canMove: boolean; onMoved: () => void }) {
  const { session } = useApp();
  const [name, setName] = useState(bot.name);
  const [role, setRole] = useState(bot.role ?? '');
  const targets = moveTargets(session.bots, bot, team);
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const [saving, setSaving] = useState<'edit' | 'move' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = editBotBody(bot, name, role);
  const save = async () => {
    if (!changed) return;
    if ('problem' in changed) { setProblem(changed.problem); return; }
    setSaving('edit'); setProblem(null);
    try {
      await session.api.viewAction('bots', 'editBot', changed.body);
      await session.refreshBasics();
      session.say(`${name.trim()}을(를) 고쳤어요`);
    } catch (e) { setProblem(errorText(e)); }
    setSaving(null);
  };
  const move = async () => {
    const target = targets.find((t) => t.id === to);
    if (!target) return;
    setSaving('move'); setProblem(null);
    try {
      await session.api.viewAction('bots', 'moveBot', { botId: bot.id, teamId: target.id });
      await session.refreshBasics();
      session.say(`${bot.name}을(를) ${target.label}(으)로 옮겼어요`);
      onMoved();
    } catch (e) { setProblem(errorText(e)); setSaving(null); }
  };
  return (
    <div className="instructions">
      {canRename && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center' }}>
            <label className="footnote" htmlFor={`bot-name-${bot.id}`}>이름</label>
            <input id={`bot-name-${bot.id}`} className="field" value={name} maxLength={EDIT_MAX.name} onChange={(e) => setName(e.target.value)} />
            <label className="footnote" htmlFor={`bot-role-${bot.id}`}>역할</label>
            <input id={`bot-role-${bot.id}`} className="field" value={role} maxLength={EDIT_MAX.role} placeholder="예: 프론트엔드 개발" onChange={(e) => setRole(e.target.value)} />
          </div>
          <div><Button kind="primary" small busy={saving === 'edit'} disabled={!changed || saving !== null} onClick={() => void save()}>저장</Button></div>
        </>
      )}
      {canMove && (bot.rank === 'lead'
        ? <div className="footnote">팀장은 다른 팀으로 옮길 수 없어요. 팀원을 옮기거나 팀 이름을 바꿔 주세요.</div>
        : targets.length === 0 ? <div className="footnote">옮길 다른 팀이 없어요.</div>
        : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="footnote">다른 팀으로</span>
            <select className="field" style={{ width: 'auto', flex: 1, minWidth: 140 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label={`${bot.name}을(를) 옮길 팀`}>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <Button kind="secondary" small busy={saving === 'move'} disabled={!to || saving !== null} onClick={() => void move()}>옮기기</Button>
          </div>
        ))}
      {problem && <div className="footnote red" role="alert">{problem}</div>}
    </div>
  );
}

const BY_LABEL = { default: '기본 글', ai: 'AI가 팀 목적에 맞게 썼어요', owner: '내가 고쳤어요' } as const;

/** §16 봇 역할 프롬프트: how this bot works. The owner can rewrite it or go back to the default.
 * Words that would skip 결재 or hide orders for the AI are refused by the Mac (confirmation rules live in code). */
function Instructions({ bot }: { bot: Bot }) {
  const { session } = useApp();
  const canEdit = viewActions(session.capabilities, 'bots').includes('setInstructions');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bot.instructions ?? '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (value: string | null) => {
    setSaving(true);
    setProblem(null);
    try {
      const r = await session.api.viewAction<{ instructions?: string }>('bots', 'setInstructions', { botId: bot.id, text: value });
      await session.refreshBasics();
      setText(r?.instructions ?? value ?? '');
      setEditing(false);
      session.say(value === null ? `${bot.name}을(를) 기본 글로 되돌렸어요` : `${bot.name}의 일하는 방식을 바꿨어요`);
    } catch (e) {
      setProblem(errorText(e, '이 글은 넣을 수 없어요. 결재 없이 하라는 내용, AI에게 내리는 숨은 지시, 너무 짧은 글은 안 돼요.'));
    }
    setSaving(false);
  };
  return (
    <div className="instructions">
      <div className="footnote" style={{ display: 'flex', gap: 6 }}>
        <span className="bold">일하는 방식</span>
        {bot.instructionsBy && <span>· {BY_LABEL[bot.instructionsBy]}</span>}
      </div>
      {editing ? (
        <>
          <textarea className="field" rows={7} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} aria-label={`${bot.name}의 일하는 방식`} autoFocus />
          <div className="footnote" style={{ textAlign: 'right' }}>{text.length} / 1500</div>
          {problem && <div className="footnote red">{problem}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="primary" small busy={saving} disabled={!text.trim() || text === bot.instructions} onClick={() => void save(text.trim())}>저장</Button>
            <Button kind="secondary" small disabled={saving} onClick={() => { setEditing(false); setText(bot.instructions ?? ''); setProblem(null); }}>취소</Button>
            {bot.instructionsBy === 'owner' && <Button kind="danger" small disabled={saving} onClick={() => void save(null)}>기본 글로 되돌리기</Button>}
          </div>
          <div className="footnote">보내기·결제·삭제는 여기 무엇을 적어도 늘 확인을 받아요.</div>
        </>
      ) : (
        <>
          <div className="selectable instructions-text">{bot.instructions ?? '아직 정해진 글이 없어요.'}</div>
          {canEdit && <div><Button kind="secondary" small onClick={() => setEditing(true)}>고치기</Button></div>}
        </>
      )}
    </div>
  );
}

function TierPicker({ value, onChange, label }: { value?: Tier; onChange: (t: Tier) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {TIERS.map((t) => <button key={t} role="radio" aria-checked={t === value} className={t === value ? 'on' : ''} onClick={() => { if (t !== value) onChange(t); }}>{t}</button>)}
    </div>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="stepper" aria-label={label}>
      <button className="btn secondary small center" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`${label} 줄이기`}>−</button>
      <span style={{ minWidth: 28, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{value}명</span>
      <button className="btn secondary small center" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`${label} 늘리기`}>+</button>
    </span>
  );
}

/** R16 팀 추가: company, name, purpose, 개발팀, then either set the members and grades or let the AI decide. */
export function AddTeamSheet({ groupId, onClose }: { groupId?: string; onClose: () => void }) {
  const { session, openRoom } = useApp();
  const groups = session.bots?.groups ?? [];
  const [group, setGroup] = useState(groupId ?? groups[0]?.id ?? 'new');
  const [newGroup, setNewGroup] = useState('');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dev, setDev] = useState(false);
  const [mode, setMode] = useState<'owner' | 'ai'>('owner');
  const [staff, setStaff] = useState(3);
  const [reviewers, setReviewers] = useState(0);
  const [tiers, setTiers] = useState<{ lead: Tier; staff: Tier; reviewer: Tier }>({ lead: 'A', staff: 'B', reviewer: 'S' });
  const [saving, setSaving] = useState(false);
  const toggleDev = (v: boolean) => { setDev(v); setReviewers((r) => (v ? Math.max(r, 1) : 0)); };
  const ready = name.trim() && (group !== 'new' || newGroup.trim());

  const save = async () => {
    setSaving(true);
    const body: Record<string, unknown> = { name: name.trim(), purpose: purpose.trim() || undefined, kind: dev ? 'dev' : 'general' };
    if (group === 'new') body.newGroupLabel = newGroup.trim(); else body.group = group;
    if (mode === 'ai') body.auto = true;
    else Object.assign(body, { staffCount: staff, reviewerCount: reviewers, tiers: reviewers ? tiers : { lead: tiers.lead, staff: tiers.staff } });
    try {
      const r = await session.api.viewAction<{ teamId: string; channel: string }>('bots', 'createTeam', body);
      await session.refreshBasics();
      session.say(`${name.trim().replace(/팀$/, '')}팀을 만들었어요`);
      onClose();
      openRoom(r.channel);
    } catch (e) { session.say(errorText(e)); }
    setSaving(false);
  };

  return (
    <Sheet title="팀 추가" onClose={onClose}>
      <Panel tight>
        <Row title="회사·영역" trailing={
          <select className="field" style={{ width: 200 }} value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            <option value="new">새로 만들기…</option>
          </select>} />
        {group === 'new' && <input className="field" placeholder="새 회사·영역 이름 (예: 모아카페 3호점)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />}
      </Panel>
      <Panel tight>
        <input className="field" style={{ fontSize: 16, fontWeight: 600, border: 0, padding: '4px 0' }} autoFocus placeholder="팀 이름 (예: 디자인팀)" value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ borderTop: '0.5px solid var(--sep)', margin: '8px 0' }} />
        <input className="field" style={{ border: 0, padding: '4px 0' }} placeholder="하는 일 (예: 화면 시안을 만들어요)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </Panel>
      <Panel tight>
        <Row title="개발팀" detail="코드를 고치는 팀이면 검수가 붙어요" trailing={<Switch on={dev} onChange={toggleDev} label="개발팀" />} />
      </Panel>
      <div><Segmented value={mode} onChange={setMode} options={[{ id: 'owner', label: '직접 정하기' }, { id: 'ai', label: 'AI에게 맡기기' }]} /></div>
      {mode === 'owner' ? (
        <Panel tight>
          <List>
            <Row title="팀장" detail="1명" trailing={<TierPicker value={tiers.lead} onChange={(t) => setTiers({ ...tiers, lead: t })} label="팀장 등급" />} />
            <Row title="직원" detail={<Stepper value={staff} min={1} max={6} onChange={setStaff} label="직원 수" />} trailing={<TierPicker value={tiers.staff} onChange={(t) => setTiers({ ...tiers, staff: t })} label="직원 등급" />} />
            <Row title="검수" detail={<Stepper value={reviewers} min={0} max={3} onChange={setReviewers} label="검수 수" />}
              trailing={reviewers > 0 ? <TierPicker value={tiers.reviewer} onChange={(t) => setTiers({ ...tiers, reviewer: t })} label="검수 등급" /> : <span className="footnote">없음</span>} />
          </List>
          <div className="footnote" style={{ paddingTop: 6 }}>등급: S 가장 똑똑함 · A · B · C 싸고 빠름. 이름과 역할 문구는 맥이 정해요.</div>
        </Panel>
      ) : (
        <div className="note-box">하는 일·일의 양·위험도와 최근 사용량·예산을 보고 AI가 인원과 등급을 정해요. 정한 이유는 팀 설정 맨 위에 보여요. 나중에 바꿀 수 있어요.</div>
      )}
      <Button kind="primary" full busy={saving} disabled={!ready} onClick={() => void save()}>팀 만들기</Button>
    </Sheet>
  );
}

function MeetingSheet({ groupId, label, onClose }: { groupId: string; label: string; onClose: () => void }) {
  const { session } = useApp();
  const [topic, setTopic] = useState('');
  const [saving, setSaving] = useState(false);
  const start = async () => {
    if (!topic.trim() || saving) return;
    setSaving(true);
    try { await session.api.viewAction('bots', 'meeting', { group: groupId, topic: topic.trim() }); session.say('회의를 열었어요'); onClose(); }
    catch (e) { session.say(errorText(e)); }
    setSaving(false);
  };
  return (
    <Sheet title={`${label} 팀장회의 열기`} onClose={onClose}>
      <div className="secondary">팀장들이 이 안건으로 의논하고, 결론을 비서 대화에 한 줄로 알려 드려요.</div>
      <input className="field" autoFocus placeholder="안건 (예: 앱 2.0 출시 날짜)" value={topic} onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void start(); }} />
      <Button kind="primary" full busy={saving} disabled={!topic.trim()} onClick={() => void start()}>회의 시작</Button>
    </Sheet>
  );
}

export const canAddTeam = (caps: Parameters<typeof hasFeature>[0]) => hasFeature(caps, 'bot-teams') && viewActions(caps, 'bots').includes('createTeam');
