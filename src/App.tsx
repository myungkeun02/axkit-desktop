import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppProvider, useApp, type Nav, type Section } from './app/context';
import { onNavigate, setAttention } from './platform/tauri';
import { recorder } from './app/recorder';
import { hasFeature, hasView } from './core/api';
import { connectionLabel, type Session } from './core/session';
import { allBots, showsMeeting, teamMembers } from './core/views';
import { Approvals } from './screens/Approvals';
import { BrowserLive } from './screens/BrowserLive';
import { Calendar } from './screens/Calendar';
import { ordinalOf } from './screens/Chat';
import { Docs, DocumentScreen } from './screens/Docs';
import { Home } from './screens/Home';
import { Projects } from './screens/Projects';
import { TeamPlanScreen } from './screens/TeamPlan';
import { Help, Welcome } from './screens/Connect';
import { PairLinkSheet } from './screens/PairLink';
import { WorkScreen } from './screens/Work';
import { PeopleScreen } from './screens/People';
import { FirstLookScreen } from './screens/FirstLook';
import {
  AutonomyScreen, Blocks, dotColor, Hardware, HealthScreen, Jobs, ModelTiers, Providers, Recordings, Routines, SectionPage, Settings, Spending, Usage,
} from './screens/Sections';
import { AddTeamSheet, canAddTeam, Faces, RoomScreen } from './screens/Teams';
import { BotAvatar } from './ui/BotAvatar';
import { Icon, iconFor } from './ui/kit';

// Heavy screens (charts) load the first time they open.
const Dashboard = lazy(() => import('./screens/Dashboard').then((m) => ({ default: m.Dashboard })));

export function App({ session }: { session: Session }) {
  // Development only: VITE_START_SECTION=docs opens straight on a section (for checking the native window).
  const start = (import.meta.env.DEV && (import.meta.env.VITE_START_SECTION as Section | undefined)) || 'home';
  const [nav, setNav] = useState<Nav>({ section: start, room: '', doc: null });
  const go = useCallback((patch: Partial<Nav>) => setNav((n) => ({ ...n, ...('section' in patch && patch.section !== n.section ? { doc: null } : {}), ...patch })), []);
  const openRoom = useCallback((room: string) => setNav((n) => ({ ...n, section: room ? 'room' : 'home', room, doc: null })), []);
  const value = useMemo(() => ({ session, nav, go, openRoom }), [session, nav, go, openRoom]);
  return (
    <AppProvider value={value}>
      <Shell />
    </AppProvider>
  );
}

/** Everything the sidebar can open, for the sidebar itself and the ⌘K palette. */
interface Dest { key: string; label: string; group: string; icon?: () => ReactNode; open: () => void; active: boolean; badge?: number; extra?: ReactNode; hint?: string }

function useDestinations(): Dest[] {
  const { session, nav, go, openRoom } = useApp();
  const caps = session.capabilities;
  const has = (v: string) => hasView(caps, v);
  const at = (s: Section) => nav.section === s;
  const sec = (key: Section, label: string, group: string, icon: () => ReactNode, show = true, extra: Partial<Dest> = {}): Dest[] =>
    show ? [{ key, label, group, icon, open: () => go({ section: key }), active: at(key), ...extra }] : [];
  const open = session.timeline.openCards().length;
  const out: Dest[] = [
    ...sec('home', session.assistantName, '비서', Icon.chat, true, { hint: '⌘1', badge: session.timeline.unreadCount('') || undefined }),
    ...sec('approvals', '결재', '비서', Icon.seal, true, { hint: '⌘2', badge: open || undefined }),
    ...sec('dashboard', '대시보드', '비서', Icon.chart, true, { hint: '⌘3' }),
    // §24: above the companies' rooms, while there is a proposal (built or dropped ones stay to look at).
    ...sec('team-plan', '팀 구조 제안', '비서', Icon.people, session.teamPlan !== null, { hint: session.teamPlan === 'proposed' ? '새 제안' : undefined }),
    ...sec('first-look', '처음 알아보기', '비서', Icon.sparkle, hasFeature(caps, 'first-look') && has('first-look')),
    ...sec('people', '사람', '비서', Icon.person, has('people')),
    ...sec('work', '하고 있는 일', '비서', Icon.checklist, has('work'), { hint: session.work?.active.length ? `${session.work.active.length}개 하는 중` : undefined }),
  ];
  // A company's rooms, newest activity first (like a messenger); the meeting room stays on top.
  const lastAt = (room: string) => { const items = session.timeline.items(room); const last = items[items.length - 1]; return last ? last.seq : 0; };
  for (const g of session.bots?.groups ?? []) {
    const group = `company:${g.id}`;
    const start = out.length;
    if (showsMeeting(g)) {
      out.push({ key: `room:${g.meetingChannel}`, label: '팀장회의', group, icon: Icon.people, open: () => openRoom(g.meetingChannel!), active: at('room') && nav.room === g.meetingChannel,
        badge: session.timeline.unreadCount(g.meetingChannel!) || undefined });
    }
    if (g.teams?.length) {
      for (const t of g.teams) {
        const members = teamMembers(session.bots, t);
        const working = members.some((m) => m.status === 'working');
        out.push({ key: `room:${t.channel}`, label: t.name, group, open: () => openRoom(t.channel), active: at('room') && nav.room === t.channel,
          badge: session.timeline.unreadCount(t.channel) || undefined,
          extra: <Faces bots={session.bots} ids={members.map((m) => m.id)} size={18} max={3} />, hint: working ? '일하는 중' : t.isNew ? '새 팀' : undefined });
      }
    } else {
      for (const b of g.bots) {
        out.push({ key: `room:${b.channel}`, label: b.name, group, open: () => openRoom(b.channel), active: at('room') && nav.room === b.channel,
          badge: session.timeline.unreadCount(b.channel) || undefined,
          extra: <BotAvatar name={b.name} size={18} avatar={b.avatar} status={b.status} ordinal={ordinalOf(session.bots, b.channel)} />, hint: b.status === 'working' ? '일하는 중' : undefined });
      }
    }
    const meetingFirst = showsMeeting(g) ? 1 : 0;
    const rooms = out.splice(start + meetingFirst);
    rooms.sort((a, b) => lastAt(b.key.slice(5)) - lastAt(a.key.slice(5)));
    out.push(...rooms);
  }
  // The Mac's other rooms (§21.2: 결재·브리핑·장애·개발 세션), under the Mac's group; read-only ones only when they hold
  // something. The old 로그 room and any "알림 방" stay hidden even when an older Mac still lists them.
  const hiddenRoom = (x: { id: string; label: string }) => { const n = x.label.replace(/\s/g, ''); return x.id === '로그' || n === '로그' || n === '알림' || n.includes('알림방') || n.includes('브리핑·알림'); };
  const meetings = new Set((session.bots?.groups ?? []).map((g) => g.meetingChannel).filter(Boolean));
  const listed = new Set(out.map((d) => d.key));
  for (const c of session.channels.filter((x) => x.id && x.kind !== 'main' && !meetings.has(x.id) && !listed.has(`room:${x.id}`) && (x.writable === true || session.timeline.items(x.id).length > 0) && !hiddenRoom(x))) {
    out.push({ key: `room:${c.id}`, label: c.label, group: c.group ?? '그 밖의 방', icon: Icon.bubble, open: () => openRoom(c.id), active: at('room') && nav.room === c.id,
      badge: session.timeline.unreadCount(c.id) || undefined });
  }
  out.push(
    ...sec('docs', '문서', '정리', Icon.doc, true, { hint: '⌘4' }),
    ...sec('calendar', '캘린더', '정리', Icon.calendar, true, { hint: '⌘5' }),
    ...sec('recordings', '녹음과 회의록', '정리', Icon.wave, hasFeature(caps, 'recordings') || has('recordings')),
    ...sec('autonomy', '알아서 하는 일', '비서가 챙기는 것', Icon.wand, has('autonomy')),
    ...sec('browser-live', '브라우저 화면 넘겨받기', '비서가 챙기는 것', Icon.globe, hasFeature(caps, 'browser-live') && has('browser-live')),
    ...sec('routines', '루틴', '비서가 챙기는 것', Icon.clock, hasFeature(caps, 'routines') || has('routines')),
    ...sec('jobs', '반복 작업', '비서가 챙기는 것', Icon.repeat, has('jobs')),
    ...sec('spending', '지출', '비서가 챙기는 것', Icon.won, has('spending')),
    ...sec('usage', '사용량', 'AI', Icon.chart, has('usage')),
    ...sec('providers', 'AI 연결', 'AI', Icon.bolt, has('providers')),
    ...sec('modeltiers', '등급과 용도', 'AI', Icon.tiers, has('modeltiers')),
    ...sec('hardware', '맥 상태', '맥', Icon.cpu, has('hardware')),
    ...sec('health', '상태 점검', '맥', Icon.check2, has('health')),
    ...sec('settings', '설정 및 연결', '맥', Icon.mac),
    ...sec('projects', '프로젝트 가져오기', '맥', Icon.box, hasFeature(caps, 'projects') && has('projects')),
    ...sec('help', '도움말', '맥', Icon.info),
    ...caps.views.filter((v) => v.ui === 'blocks').flatMap((v) => sec(`blocks:${v.name}`, v.title ?? v.name, '새 기능', iconFor(v.icon))),
  );
  return out;
}

const GROUP_ORDER = ['비서', 'companies', 'rooms', '정리', '비서가 챙기는 것', 'AI', '맥', '새 기능'];

function Shell() {
  const { session, nav, go } = useApp();
  const dests = useDestinations();
  const [palette, setPalette] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const openCount = session.timeline.openCards().length;
  const teamsOn = canAddTeam(session.capabilities);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      const order: Section[] = ['home', 'approvals', 'dashboard', 'docs', 'calendar'];
      const i = Number(e.key) - 1;
      if (!e.shiftKey && i >= 0 && i < order.length) { e.preventDefault(); go({ section: order[i] }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  useEffect(() => { if (session.connection === 'live') void recorder.send(); }, [session.connection]);
  useEffect(() => { document.title = openCount ? `ax-kit (결재 ${openCount})` : 'ax-kit'; void setAttention(openCount); }, [openCount]);
  useEffect(() => {
    const off = onNavigate((section) => go({ section: section as Section }));
    return () => { void off.then((f) => f()); };
  }, [go]);

  const groups = session.bots?.groups ?? [];
  const roomGroups = [...new Set(session.channels.filter((c) => c.kind !== 'team' && c.kind !== 'main').map((c) => c.group ?? '회사 운영'))]
    .filter((g) => !groups.some((c) => c.label === g));
  const sections = GROUP_ORDER.flatMap((g) => (g === 'companies' ? groups.map((c) => `company:${c.id}`) : g === 'rooms' ? roomGroups : [g]));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-top" data-tauri-drag-region>
          <button className="search-btn" onClick={() => setPalette(true)} title="어디로든 가기 (⌘K)">
            <span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.search /></span>
            <span style={{ flex: 1 }}>찾아 가기</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
        <nav className="sidebar-scroll" aria-label="메뉴">
          {sections.map((g) => {
            const items = dests.filter((d) => d.group === g);
            const company = g.startsWith('company:') ? groups.find((c) => `company:${c.id}` === g) : undefined;
            if (!items.length && !company) return null;
            return (
              <section key={g} className="side-group">
                <div className="side-head">
                  <span>{company ? company.label : g}</span>
                  {company && teamsOn && <button className="side-add" title={`${company.label}에 팀 추가`} aria-label={`${company.label}에 팀 추가`} onClick={() => setAdding(company.id)}><Icon.plus /></button>}
                </div>
                {items.map((d) => (
                  <button key={d.key} className={`tab${d.active ? ' on' : ''}`} onClick={d.open} aria-current={d.active ? 'page' : undefined}>
                    {d.extra ?? (d.icon ? <d.icon /> : null)}
                    <span className="tab-label">{d.label}</span>
                    {d.badge ? <span className={`badge${d.key === 'approvals' ? '' : ' soft'}`}>{d.badge}</span> : d.hint ? <span className="tab-hint">{d.hint}</span> : null}
                  </button>
                ))}
              </section>
            );
          })}
          {teamsOn && <button className="tab add-team" onClick={() => setAdding('')}><Icon.plus /><span className="tab-label">팀 추가</span></button>}
        </nav>
        <button className="foot" onClick={() => go({ section: 'settings' })} title="설정 및 연결">
          <span className="dot" style={{ background: dotColor(session.connection) }} />
          <span>{session.info?.mode === 'mock' ? '가짜 맥 · ' : session.info?.mode === 'remote' ? `${session.info.host ?? '다른 맥'} · ` : ''}{connectionLabel[session.connection]}</span>
        </button>
      </aside>
      <main className="main">
        {session.connection === 'none' && nav.section !== 'settings' && nav.section !== 'help' ? <Welcome /> : <Screen />}
      </main>
      {palette && <Palette dests={dests} onClose={() => setPalette(false)} />}
      {adding !== null && <AddTeamSheet groupId={adding || undefined} onClose={() => setAdding(null)} />}
      <PairLinkSheet />
      <Toast />
    </div>
  );
}

function Screen() {
  const { nav, go, session } = useApp();
  const s = nav.section;
  switch (s) {
    case 'home': return <Home />;
    case 'approvals': return <Approvals />;
    case 'dashboard': return <Suspense fallback={<Loading />}><Dashboard /></Suspense>;
    case 'room': return <RoomScreen room={nav.room} />;
    case 'browser-live': return <BrowserLive />;
    case 'docs': return <Docs />;
    case 'calendar': return <Calendar />;
    case 'recordings': return nav.doc ? <DocumentScreen id={nav.doc} onBack={() => go({ doc: null })} backLabel="녹음과 회의록" /> : <SectionPage title="녹음과 회의록"><Recordings /></SectionPage>;
    case 'autonomy': return <SectionPage title="알아서 하는 일"><AutonomyScreen /></SectionPage>;
    case 'routines': return <SectionPage title="루틴"><Routines /></SectionPage>;
    case 'jobs': return <SectionPage title="반복 작업"><Jobs /></SectionPage>;
    case 'spending': return <SectionPage title="지출" wide><Spending /></SectionPage>;
    case 'usage': return <SectionPage title="봇·AI 사용량" wide><Usage /></SectionPage>;
    case 'providers': return <SectionPage title="AI 연결"><Providers /></SectionPage>;
    case 'modeltiers': return <SectionPage title="AI 등급과 용도"><ModelTiers /></SectionPage>;
    case 'hardware': return <SectionPage title="맥 상태"><Hardware /></SectionPage>;
    case 'health': return <SectionPage title="상태 점검"><HealthScreen /></SectionPage>;
    case 'settings': return <SectionPage title="설정 및 연결"><Settings /></SectionPage>;
    case 'projects': return <Projects />;
    case 'team-plan': return <TeamPlanScreen />;
    case 'first-look': return <SectionPage title="처음 알아보기"><FirstLookScreen /></SectionPage>;
    case 'work': return <SectionPage title="하고 있는 일"><WorkScreen /></SectionPage>;
    case 'people': return <SectionPage title="사람"><PeopleScreen /></SectionPage>;
    case 'help': return <SectionPage title="도움말: 처음 쓰는 법"><Help /></SectionPage>;
    default: {
      const name = s.slice('blocks:'.length);
      const info = session.capabilities.views.find((v) => v.name === name);
      return <SectionPage title={info?.title ?? name}><Blocks name={name} /></SectionPage>;
    }
  }
}

function Loading() {
  return <div className="center-fill"><span className="spinner" /></div>;
}

/** ⌘K: type a few letters of any section or team and press Enter. */
function Palette({ dests, onClose }: { dests: Dest[]; onClose: () => void }) {
  const { session } = useApp();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const groupLabel = (g: string) => (g.startsWith('company:') ? session.bots?.groups.find((c) => `company:${c.id}` === g)?.label ?? '' : g);
  const bots = allBots(session.bots);
  const query = q.trim().toLowerCase();
  const list = dests.filter((d) => !query || d.label.toLowerCase().includes(query) || groupLabel(d.group).toLowerCase().includes(query)
    || (d.key.startsWith('room:') && bots.some((b) => `room:${b.channel}` === d.key && b.name.toLowerCase().includes(query)))).slice(0, 12);
  const pick = (d?: Dest) => { if (d) { d.open(); onClose(); } };
  return (
    <div className="sheet-dim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ alignItems: 'flex-start', paddingTop: 90 }}>
      <div className="palette" role="dialog" aria-label="찾아 가기">
        <input ref={input} className="palette-input" placeholder="어디로 갈까요? (예: 결재, 개발팀, 지출)" value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, list.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            if (e.key === 'Enter') pick(list[i]);
          }} />
        <div className="palette-list" role="listbox">
          {list.map((d, j) => (
            <button key={d.key} role="option" aria-selected={j === i} className={`palette-row${j === i ? ' on' : ''}`} onMouseEnter={() => setI(j)} onClick={() => pick(d)}>
              <span className="palette-icon">{d.extra ?? (d.icon ? <d.icon /> : null)}</span>
              <span style={{ flex: 1 }}>{d.label}</span>
              <span className="footnote">{groupLabel(d.group)}</span>
            </button>
          ))}
          {!list.length && <div className="secondary" style={{ padding: 14 }}>찾는 곳이 없어요</div>}
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const { session } = useApp();
  const toast = session.toast;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.id);
    const t = setTimeout(() => setShown(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || shown !== toast.id) return null;
  return <div className="toast" role="status" onClick={() => setShown(null)}>{toast.text}</div>;
}
