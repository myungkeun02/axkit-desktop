// Opt-in: checks the app's client and screen data against a REAL ax-kit server on this Mac.
//   AXKIT_TOKEN_FILE=~/.ax-kit/desktop.token npx vitest run src/core/real-server.test.ts
// Skipped when the variable is not set. Read-only apart from one chat message.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWork } from './work';
import { decodeFirstLook } from './firstLook';
import { ApiClient, ApiError, errorText, hasFeature, hasView, type RawReply, type Transport } from './api';
import { Session } from './session';
import { memoryStorage } from './outbox';
import { recordingId } from './recordings';
import { areasOf, documentOf } from './knowledge';
import { healthOf } from './health';
import { activityLine } from './activity';
import { afterDone } from './browserLive';
import { addRole, appliedLine, decodePlan, editRole, NOT_PROPOSED, renameCompany as renamePlanCompany, saveBody as planBody } from './teamPlan';
import { changed, companiesOf, decodeProjects, draftOf, pick, renameProject, saveBody, scanTitle } from './projects';
import type {
  AutonomyView, BlocksView, BotsView, CalendarView, DocGraphView, HardwareView, JobsView, ModelTiersView, ProvidersView, RecordingsView, RoutinesView, TodayView, UsageView,
} from './views';

const FILE = process.env.AXKIT_TOKEN_FILE;

function transport(): Transport {
  const { baseUrl, token } = JSON.parse(readFileSync(FILE!, 'utf8')) as { baseUrl: string; token: string };
  const base = baseUrl.replace(/\/$/, '');
  return {
    async call(method, path, query, body): Promise<RawReply> {
      const url = new URL(`${base}/m/v1/app/${path}`);
      for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
      const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    async upload(path, bytes, headers): Promise<RawReply> {
      const res = await fetch(`${base}/m/v1/app/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: bytes as BodyInit });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}

describe.skipIf(!FILE)('against the real ax-kit server', () => {
  const api = () => new ApiClient(transport());

  it('reads capabilities, status and events', async () => {
    const a = api();
    const caps = await a.capabilities();
    expect(caps.features).toContain('chat');
    const status = await a.status();
    expect(status.assistant.name.length).toBeGreaterThan(0);
    const page = await a.events(0, 50);
    expect(page.events.every((e) => typeof e.seq === 'number')).toBe(true);
  });

  it('decodes every view the screens use, in the shape they read', async () => {
    const a = api();
    const caps = await a.capabilities();
    const month = new Date().toISOString().slice(0, 7);
    const has = (v: string) => hasView(caps, v);
    if (has('today')) { const t = await a.view<TodayView>('today'); expect(typeof t.date).toBe('string'); }
    if (has('bots')) { const b = await a.view<BotsView>('bots'); expect(Array.isArray(b.groups)).toBe(true); }
    if (has('docgraph')) { const g = await a.view<DocGraphView>('docgraph'); expect(Array.isArray(g.nodes) && Array.isArray(g.links) && Array.isArray(g.layers)).toBe(true); }
    if (has('calendar')) { const c = await a.view<CalendarView>('calendar', { month }); expect(Array.isArray(c.days)).toBe(true); }
    if (has('usage')) { const u = await a.view<UsageView>('usage', { period: 'month' }); expect(typeof u.totals.calls).toBe('number'); expect(Array.isArray(u.byModel)).toBe(true); }
    if (has('jobs')) { const j = await a.view<JobsView>('jobs'); expect(Array.isArray(j.groups)).toBe(true); }
    if (has('autonomy')) { const r = await a.view<AutonomyView>('autonomy'); expect(Array.isArray(r.rules)).toBe(true); }
    if (has('modeltiers')) { const m = await a.view<ModelTiersView>('modeltiers'); expect(Array.isArray(m.tiers) && Array.isArray(m.purposes)).toBe(true); }
    if (has('providers')) { const p = await a.view<ProvidersView>('providers'); expect(Array.isArray(p.providers)).toBe(true); }
    if (has('routines')) { const r = await a.view<RoutinesView>('routines'); expect(Array.isArray(r.routines) && Array.isArray(r.followUps)).toBe(true); }
    if (has('knowledge')) {
      const areas = areasOf(await a.view<unknown>('knowledge'));
      expect(Array.isArray(areas)).toBe(true);
      const first = areas[0]?.docs[0];
      if (first) expect(documentOf(await a.view<unknown>('knowledge', { doc: first.id }))?.id).toBe(first.id);
    }
    if (has('work')) {
      // §28: the raw reply carries both lists even when nothing runs.
      const raw = await a.view<{ active: unknown; recent: unknown }>('work');
      expect(Array.isArray(raw.active) && Array.isArray(raw.recent)).toBe(true);
      const w = decodeWork(raw);
      expect(w.active.length + w.recent.length).toBe((raw.active as unknown[]).length + (raw.recent as unknown[]).length);
    }
    if (has('first-look')) {
      // §27: status, five phases in order, a percent.
      const f = decodeFirstLook(await a.view<unknown>('first-look'));
      expect(['idle', 'running', 'paused', 'done', 'failed']).toContain(f.status);
      expect(f.phases.map((p) => p.id)).toEqual(['local', 'projects', 'drive', 'signals', 'profile']);
      expect(f.percent).toBeGreaterThanOrEqual(0);
    }
    if (has('health')) { const h = healthOf(await a.view<unknown>('health')); expect(h.checks.length).toBeGreaterThan(0); }
    if (has('browser-live')) {
      // §22: nothing handed over on a test server — the refusals carry plain reasons.
      const live = await a.view<{ live: boolean }>('browser-live');
      expect(typeof live.live).toBe('boolean');
      if (!live.live) {
        await expect(a.viewAction('browser-live', 'tap', { x: 1, y: 1 })).rejects.toMatchObject({ kind: 'badRequest', serverMessage: expect.stringContaining('닫혀') });
      }
      if (!live.live && !(live as { pending?: unknown }).pending) {
        // `done` with nothing open: nothing to carry on, so no continuedIn/channel and the app goes to the main chat.
        const d = await a.viewAction<{ resumed?: boolean; continuedIn?: string; channel?: string }>('browser-live', 'done', {});
        expect(d.resumed).toBe(false);
        expect(d.continuedIn).toBeUndefined();
        expect(afterDone(d)).toEqual({ room: '', say: '브라우저 화면을 닫았어요.' });
      }
    }
    if (has('hardware')) { const h = await a.view<HardwareView>('hardware'); expect(typeof h.machine.name).toBe('string'); }
    for (const v of caps.views.filter((x) => x.ui === 'blocks')) {
      const b = await a.view<BlocksView>(v.name);
      expect(Array.isArray(b.blocks)).toBe(true);
    }
  });

  it('runs a whole session: catch-up and a message with the same clientId once', async () => {
    const t = transport();
    let streamed: ((d: string) => void) | undefined;
    const session = new Session({
      transport: t,
      connection: async () => ({ mode: 'local', connected: true, devBuild: true }),
      reconnect: async () => ({ mode: 'local', connected: true, devBuild: true }),
      useMock: async () => ({ mode: 'local', connected: true, devBuild: true }),
      useLocal: async () => ({ mode: 'local', connected: true, devBuild: true }),
      streamStart: async () => {}, streamStop: async () => {},
      onStreamEvent: async (cb) => { streamed = cb; return () => {}; },
      onStreamState: async () => () => {},
      pairRemote: async () => { throw 'unused'; },
      forgetRemote: async () => { throw 'unused'; },
      onServerChanged: async () => () => {},
      nudge: async () => {},
    }, memoryStorage());
    await session.start();
    expect(streamed).toBeDefined();
    const before = session.timeline.lastSeq;
    session.send('데스크톱 앱 시험: 실제 서버 세션', '');
    await new Promise((r) => setTimeout(r, 300));
    await session.flushOutbox();
    expect(session.outbox.pending).toHaveLength(0);
    expect(session.timeline.lastSeq).toBeGreaterThan(before);
  });

  it('shows "생각하는 중" from the live stream and clears it when the answer comes (feature activity)', async () => {
    const t = transport();
    const { baseUrl, token } = JSON.parse(readFileSync(FILE!, 'utf8')) as { baseUrl: string; token: string };
    let streamed: ((d: string) => void) | undefined;
    const session = new Session({
      transport: t,
      connection: async () => ({ mode: 'local', connected: true, devBuild: true }),
      reconnect: async () => ({ mode: 'local', connected: true, devBuild: true }),
      useMock: async () => ({ mode: 'local', connected: true, devBuild: true }),
      useLocal: async () => ({ mode: 'local', connected: true, devBuild: true }),
      streamStart: async () => {}, streamStop: async () => {},
      onStreamEvent: async (cb) => { streamed = cb; return () => {}; },
      onStreamState: async () => () => {},
      pairRemote: async () => { throw 'unused'; },
      forgetRemote: async () => { throw 'unused'; },
      onServerChanged: async () => () => {},
      nudge: async () => {},
    }, memoryStorage());
    await session.start();
    if (!hasFeature(session.capabilities, 'activity')) return;
    // The real stream, read like the app's stream readers do, fed into the session.
    const abort = new AbortController();
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/m/v1/app/stream`, { headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': String(session.timeline.lastSeq) }, signal: abort.signal });
    const seen: string[] = [];
    const reading = (async () => {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const data = buf.slice(0, i).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
          buf = buf.slice(i + 2);
          if (!data) continue;
          streamed!(data);
          const a = session.activity.get('');
          const type = (JSON.parse(data) as { type: string; state?: string }).type;
          seen.push(`${type === 'activity' ? `activity:${(JSON.parse(data) as { state: string }).state}` : type} → ${a ? activityLine(a) : '-'}`);
          if (type === 'activity' && (JSON.parse(data) as { state: string }).state === 'idle') { abort.abort(); return; }
        }
      }
    })();
    session.send('데스크톱 앱 시험: 생각하는 중 표시', '');
    await session.flushOutbox();
    await Promise.race([reading, new Promise((r) => setTimeout(r, 20_000))]);
    abort.abort();
    expect(seen).toContain('activity:thinking → 생각하는 중');
    expect(seen[seen.length - 1]).toBe('activity:idle → -');
    expect(session.activity.get('')).toBeNull();
  }, 30_000);

  // Set AXKIT_RECORDING to an audio file (e.g. made with `say` + `afconvert -d aac`) to send it as a meeting recording.
  it.skipIf(!process.env.AXKIT_PROJECTS_SAVE)('프로젝트 가져오기: list, refresh, save the picks without reading, refuse an unknown folder (feature projects; changes the picks)', async () => {
    const a = api();
    const caps = await a.capabilities();
    if (!hasFeature(caps, 'projects') || !hasView(caps, 'projects')) return;
    const v = decodeProjects(await a.view('projects'));
    expect(scanTitle(v.scan).length).toBeGreaterThan(0);
    const fresh = decodeProjects(await a.viewAction('projects', 'refresh', {}));
    expect(fresh.companies.length).toBe(v.companies.length);
    const first = fresh.companies[0]?.projects[0];
    if (!first) return;
    let d = renameProject(pick(draftOf(fresh), first.path, true), first.path, `${first.name} 시험`);
    expect(changed(d, fresh)).toBe(true);
    const r = await a.viewAction<{ saved: number; scan?: string }>('projects', 'save', saveBody(d, false));
    expect(r.saved).toBe(saveBody(d, false).projects.length);
    expect(r.scan).toBeUndefined();
    const after = decodeProjects(await a.view('projects'));
    const row = companiesOf(draftOf(after)).flatMap((c) => c.projects).find((p) => p.path === first.path)!;
    expect(row.picked).toBe(true);
    expect(row.name).toBe(`${first.name} 시험`);
    expect(changed(draftOf(after), after)).toBe(false);
    // A folder that was never found: 400 with the owner's sentence, shown as is.
    const e = await a.viewAction('projects', 'save', { projects: [{ path: '/nowhere/x', name: 'x', company: 'y' }], rescan: false }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(errorText(e)).toBe('찾은 목록에 없는 폴더예요. 목록을 새로 고친 뒤 골라 주세요.');
    // Put the picks back the way they were.
    d = draftOf(fresh);
    await a.viewAction('projects', 'save', saveBody(d, false));
  });

  it.skipIf(!process.env.AXKIT_TEAMPLAN)('팀 구조 제안: edit and save the whole list, refuse a long role, build it, then saving is refused (feature team-plan; builds teams)', async () => {
    const a = api();
    const caps = await a.capabilities();
    if (!hasFeature(caps, 'team-plan') || !hasView(caps, 'team-plan')) return;
    const plan = decodePlan(await a.view('team-plan'));
    if (!plan || plan.status !== 'proposed') return;
    let teams = addRole(plan.teams, 0);
    teams = editRole(teams, 0, teams[0].roles.length - 1, { title: '새 역할' });
    teams = renamePlanCompany(teams, teams[0].company, `${teams[0].company} 고침`);
    expect(await a.viewAction<{ saved: number }>('team-plan', 'save', planBody(teams))).toEqual({ saved: teams.length });
    const saved = decodePlan(await a.view('team-plan'))!;
    expect(saved.teams[0].company).toBe(teams[0].company.trim());
    expect(saved.teams[0].roles.map((r) => r.title)).toContain('새 역할');
    // 21 letters: the server says no (the screen stops it before).
    const long = editRole(teams, 0, 0, { title: '가'.repeat(21) });
    expect(await a.viewAction('team-plan', 'save', { teams: long }).catch((e: unknown) => e)).toBeInstanceOf(ApiError);
    const made = await a.viewAction<{ teams: number; routines: number }>('team-plan', 'apply', {});
    expect(made.teams).toBeGreaterThan(0);
    expect(appliedLine(made)).toMatch(/^팀 \d+개/);
    const after = decodePlan(await a.view('team-plan'))!;
    expect(after.status).toBe('applied');
    const bots = await a.view<BotsView>('bots');
    expect(bots.groups.some((g) => g.label === teams[0].company.trim().slice(0, 40))).toBe(true);
    // Built: saving again is refused without a sentence, and the screen says it in its own words.
    const e = await a.viewAction('team-plan', 'save', planBody(teams)).catch((x: unknown) => x);
    expect(errorText(e, NOT_PROPOSED)).toBe(NOT_PROPOSED);
    expect(await a.viewAction<{ teams: number }>('team-plan', 'apply', {})).toEqual({ teams: 0, routines: 0 });
    expect(await a.viewAction<{ declined: boolean }>('team-plan', 'decline', {})).toEqual({ declined: false });
  });

  it.skipIf(!process.env.AXKIT_RECORDING)('uploads a recording in pieces and the Mac takes it', async () => {
    const a = api();
    const caps = await a.capabilities();
    if (!hasView(caps, 'recordings')) return;
    const bytes = new Uint8Array(readFileSync(process.env.AXKIT_RECORDING!));
    const id = recordingId();
    const half = Math.ceil(bytes.length / 2);
    const r0 = await a.uploadChunk(id, 0, 2, bytes.subarray(0, half), new Date().toISOString(), 5);
    expect(r0).toEqual({ received: 1, complete: false });
    const r1 = await a.uploadChunk(id, 1, 2, bytes.subarray(half), new Date().toISOString(), 5);
    expect(r1.complete).toBe(true);
    const again = await a.uploadChunk(id, 1, 2, bytes.subarray(half), new Date().toISOString(), 5);
    expect(again).toEqual({ received: 2, complete: true });
    const list = await a.view<RecordingsView>('recordings');
    expect(list.recordings.some((r) => r.id === id)).toBe(true);
  });
});
