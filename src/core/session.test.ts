import { describe, expect, it, vi } from 'vitest';
import type { RawReply, Transport } from './api';
import { memoryStorage } from './outbox';
import { choiceClientId, Session, type ConnInfo, type PairInput, type Platform, type StreamStateName } from './session';

/** A fake Mac: an event log, a capabilities list and a stream the test pushes into. */
class FakeMac implements Transport {
  events: Record<string, unknown>[] = [];
  sent: Record<string, unknown>[] = [];
  cardsAnswered: { path: string; body: unknown }[] = [];
  offline = false;
  features = ['chat', 'cards', 'card-reply', 'bots'];
  lastSeqOverride: number | null = null;
  /** Answer `POST messages` with this status (429, 400, 401…) instead of taking it. */
  messageStatus: number | null = null;

  add(e: Record<string, unknown>) {
    const seq = (this.events.at(-1)?.seq as number | undefined ?? 0) + 1;
    const ev = { at: new Date().toISOString(), ...e, seq };
    this.events.push(ev);
    return ev;
  }

  async call(method: 'GET' | 'POST', path: string, query?: Record<string, string>, body?: unknown): Promise<RawReply> {
    if (this.offline) throw new Error('offline');
    const ok = (b: Record<string, unknown>) => ({ status: 200, body: { ok: true, ...b } });
    if (path === 'capabilities') return ok({ protocol: 1, features: this.features, views: [{ name: 'bots', version: 1 }] });
    if (path === 'status') return ok({ assistant: { name: '비서' }, lastSeq: this.lastSeqOverride ?? (this.events.at(-1)?.seq ?? 0), stopped: true });
    if (path === 'views/bots') return ok({ data: { groups: [{ id: 'g', label: '한빛랩', bots: [{ id: 'dev', name: '개발 봇', channel: 'dev' }] }] } });
    if (path === 'events') {
      const after = Number(query?.after ?? 0);
      const limit = Number(query?.limit ?? 100);
      return ok({ events: this.events.filter((e) => (e.seq as number) > after).slice(0, limit), lastSeq: this.events.at(-1)?.seq ?? 0 });
    }
    if (path === 'messages' && method === 'POST') {
      if (this.messageStatus) return { status: this.messageStatus, body: { ok: false, error: 'x' } };
      const b = body as Record<string, unknown>;
      const dup = this.sent.find((s) => s.clientId && s.clientId === b.clientId);
      if (dup) return ok({ seq: dup.seq, duplicate: true });
      const ev = this.add({ type: 'message', role: 'owner', text: b.text, channel: b.channel });
      this.sent.push({ ...b, seq: ev.seq });
      return ok({ seq: ev.seq });
    }
    if (path.startsWith('messages/') && path.endsWith('/react')) { this.sent.push({ react: path, ...(body as object) }); return ok({}); }
    if (path.startsWith('cards/')) {
      this.cardsAnswered.push({ path, body });
      if (path === 'cards/gone') return { status: 410, body: { ok: false, error: 'gone' } };
      return ok({ state: 'approved', reply: '처리했어요' });
    }
    return { status: 404, body: { ok: false } };
  }

  async upload(): Promise<RawReply> { return { status: 200, body: { ok: true } }; }
}

class FakePlatform implements Platform {
  streamCb: (d: string) => void = () => {};
  stateCb: (s: StreamStateName) => void = () => {};
  started: { after: number; reset: boolean }[] = [];
  info: ConnInfo = { mode: 'local', connected: true, host: '127.0.0.1:47617', devBuild: true };
  constructor(readonly transport: FakeMac) {}
  async connection() { return this.info; }
  async reconnect() { return this.info; }
  async useMock() { return { ...this.info, mode: 'mock' as const }; }
  async useLocal() { return this.info; }
  async streamStart(after: number, reset: boolean) { this.started.push({ after, reset }); }
  async streamStop() {}
  async onStreamEvent(cb: (d: string) => void) { this.streamCb = cb; return () => {}; }
  async onStreamState(cb: (s: StreamStateName) => void) { this.stateCb = cb; return () => {}; }
  paired: PairInput[] = [];
  async pairRemote(input: PairInput) {
    this.paired.push(input);
    if ('code' in input && input.code === '000000') throw '코드가 맞지 않아요. 4번 더 해 볼 수 있어요.';
    this.info = { ...this.info, mode: 'remote', host: 'macmini.ts.net', deviceName: '작업용 맥북' };
    return this.info;
  }
  serverCb: () => void = () => {};
  nudged = 0;
  async onServerChanged(cb: () => void) { this.serverCb = cb; return () => {}; }
  async nudge() { this.nudged++; }
  async forgetRemote() { this.info = { ...this.info, mode: 'local', host: '127.0.0.1:47617', deviceName: null }; return this.info; }
}

function setup() {
  const mac = new FakeMac();
  const platform = new FakePlatform(mac);
  const session = new Session(platform, memoryStorage());
  return { mac, platform, session };
}

describe('Session', () => {
  it('catches up, then streams from the last seq, and drops duplicates from the stream', async () => {
    const { mac, platform, session } = setup();
    for (let i = 0; i < 3; i++) mac.add({ type: 'message', role: 'assistant', text: `hi ${i}` });
    await session.start();
    expect(session.timeline.items('')).toHaveLength(3);
    expect(platform.started).toEqual([{ after: 3, reset: false }]);
    expect(session.stopped).toBe(true);
    expect(session.bots?.groups[0].bots[0].name).toBe('개발 봇');
    // The stream re-sends #3 and then a new one.
    platform.streamCb(JSON.stringify(mac.events[2]));
    platform.streamCb(JSON.stringify(mac.add({ type: 'notice', text: 'new' })));
    platform.streamCb('garbage');
    expect(session.timeline.items('').map((i) => i.seq)).toEqual([1, 2, 3, 4]);
    platform.stateCb('live');
    expect(session.connection).toBe('live');
  });

  it('pairs with another Mac: a wrong code keeps the old connection, a good one starts over', async () => {
    const { mac, platform, session } = setup();
    mac.add({ type: 'message', role: 'assistant', text: 'from this Mac' });
    await session.start();
    await expect(session.pairRemote({ address: 'https://macmini.ts.net', code: '000000', nonce: 'n' })).rejects.toThrow('코드가 맞지 않아요');
    expect(session.info?.mode).toBe('local');
    expect(session.timeline.lastSeq).toBe(1);
    await session.pairRemote({ link: 'axkit://pair?u=https%3A%2F%2Fmacmini.ts.net&n=n&c=123456' });
    expect(session.info).toMatchObject({ mode: 'remote', deviceName: '작업용 맥북' });
    expect(platform.started.at(-1)).toEqual({ after: 1, reset: true });
    await session.forgetRemote();
    expect(session.info?.mode).toBe('local');
  });

  it('pages through a long gap', async () => {
    const { mac, session } = setup();
    for (let i = 0; i < 450; i++) mac.add({ type: 'message', role: 'assistant', text: `m${i}` });
    await session.start();
    expect(session.timeline.lastSeq).toBe(450);
  });

  it('starts over when the server log restarted', async () => {
    const { mac, platform, session } = setup();
    mac.add({ type: 'message', role: 'assistant', text: 'a' });
    mac.add({ type: 'message', role: 'assistant', text: 'b' });
    await session.start();
    mac.events = [];
    mac.add({ type: 'message', role: 'assistant', text: 'fresh' });
    await session.connect(false);
    expect(session.timeline.items('').map((i) => i.kind === 'message' && i.event.text)).toEqual(['fresh']);
    expect(platform.started.at(-1)).toEqual({ after: 1, reset: true });
  });

  it('keeps messages written offline and sends each once when back', async () => {
    const { mac, session } = setup();
    await session.start();
    mac.offline = true;
    session.send('  원두 주문해 줘  ', '');
    session.send('개발 봇 안녕', 'dev');
    await new Promise((r) => setTimeout(r, 0));
    expect(session.pendingIn('')).toHaveLength(1);
    mac.offline = false;
    await session.flushOutbox();
    await session.flushOutbox();
    expect(mac.sent.map((s) => [s.text, s.channel])).toEqual([['원두 주문해 줘', undefined], ['개발 봇 안녕', 'dev']]);
    expect(session.outbox.pending).toHaveLength(0);
    expect(session.timeline.items('dev')).toHaveLength(1);
  });

  it('keeps a refused message as failed (send again / delete), waits on 401 and retries 429 on its own', async () => {
    vi.useFakeTimers();
    try {
      const { mac, session } = setup();
      await session.start();
      mac.messageStatus = 400;
      session.send('150000원 보내줘', '');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.pendingIn('')).toMatchObject([{ text: '150000원 보내줘', failed: expect.any(String) }]);
      mac.messageStatus = null;
      session.resend(session.pendingIn('')[0].id);
      await vi.advanceTimersByTimeAsync(0);
      expect(mac.sent.map((x) => x.text)).toEqual(['150000원 보내줘']);
      mac.messageStatus = 401;
      session.send('기다려', '');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.pendingIn('')).toMatchObject([{ text: '기다려' }]);
      expect(session.pendingIn('')[0].failed).toBeUndefined();
      mac.messageStatus = 429;
      await vi.advanceTimersByTimeAsync(2100);
      expect(session.pendingIn('')).toHaveLength(1);
      mac.messageStatus = null;
      await vi.advanceTimersByTimeAsync(4100);
      expect(session.pendingIn('')).toHaveLength(0);
      expect(mac.sent.map((x) => x.text)).toEqual(['150000원 보내줘', '기다려']);
      session.send('지울 말', '');
      mac.messageStatus = 400;
      await vi.advanceTimersByTimeAsync(0);
      session.discard(session.pendingIn('')[0]?.id ?? '');
    } finally {
      vi.useRealTimers();
    }
  });

  it('after the stream comes back on its own, reads everything again; a restarted log restarts the stream from there', async () => {
    const { mac, platform, session } = setup();
    mac.add({ type: 'message', role: 'assistant', text: 'a' });
    mac.add({ type: 'message', role: 'assistant', text: 'b' });
    await session.start();
    platform.stateCb('live');
    (session as unknown as { connectedAt: number }).connectedAt = 0;
    session.activity.apply({ room: '', state: 'thinking', at: Date.now() });
    platform.stateCb('waiting');
    expect(session.activity.get('')).toBeNull();
    mac.events = [];
    mac.add({ type: 'message', role: 'assistant', text: 'fresh' });
    platform.stateCb('live');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(session.timeline.items('').map((i) => i.kind === 'message' && i.event.text)).toEqual(['fresh']);
    expect(platform.started.at(-1)).toEqual({ after: 1, reset: true });
  });

  it('sends a choice once, and starts over when another window switches servers', async () => {
    const { mac, platform, session } = setup();
    mac.add({ type: 'message', role: 'assistant', text: 'old' });
    await session.start();
    const choice = { id: 'yes', label: '네' };
    await Promise.all([session.choose(choice, '', 1), session.choose(choice, '', 1)]);
    expect(mac.events.filter((e) => e.role === 'owner')).toHaveLength(1);
    expect(mac.sent[0]).toMatchObject({ clientId: 'choice-1-yes' });
    expect(mac.sent[0]).not.toHaveProperty('channel');
    mac.events = [];
    platform.info = { ...platform.info, mode: 'remote', host: 'macmini.ts.net' };
    platform.serverCb();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(session.info?.mode).toBe('remote');
    expect(session.timeline.lastSeq).toBe(0);
    expect(session.scope).toBe('remote:macmini.ts.net');
  });

  it('answers cards with remember, and closes gone cards', async () => {
    const { mac, session } = setup();
    mac.add({ type: 'card', cardId: 'beans', summary: '어떻게 할까요?', effects: ['pay'], effectLabels: [], remember: { label: 'L' },
      options: [{ id: 'buy', label: '사요', tone: 'primary' }] });
    mac.add({ type: 'card', cardId: 'gone', summary: '?', effects: [], effectLabels: [] });
    await session.start();
    const beans = session.timeline.card('beans')!;
    expect(await session.answerOption(beans, beans.options![0], true)).toBe(true);
    expect(mac.cardsAnswered[0]).toEqual({ path: 'cards/beans', body: { option: 'buy', remember: true } });
    expect(session.timeline.isOpen('beans')).toBe(false);
    expect(await session.answer(session.timeline.card('gone')!, { text: '내일 해' })).toBe(false);
    expect(session.timeline.closure('gone')?.state).toBe('closed');
  });

  it('without card-reply, a written answer becomes "edit" plus a message', async () => {
    const { mac, session } = setup();
    mac.features = ['chat', 'cards'];
    mac.add({ type: 'card', cardId: 'c1', summary: '보낼까요?', effects: ['send'], effectLabels: [] });
    await session.start();
    await session.answer(session.timeline.card('c1')!, { text: '금요일에 보내' });
    await session.flushOutbox();
    expect(mac.cardsAnswered[0].body).toEqual({ decision: 'edit' });
    expect(mac.sent[0].text).toBe('[결재 답: 보낼까요?] 금요일에 보내');
  });

  it('shows "not connected" without calling the Mac when there is no token file', async () => {
    const { mac, platform, session } = setup();
    platform.info = { mode: 'local', connected: false, problem: 'ax-kit가 꺼져 있어요', devBuild: true };
    mac.offline = true;
    await session.start();
    expect(session.connection).toBe('none');
    expect(platform.started).toHaveLength(0);
  });

  it('sends a reaction and remembers it', async () => {
    const { mac, session } = setup();
    const m = mac.add({ type: 'message', role: 'assistant', text: '브리핑이에요' });
    await session.start();
    await session.react(m.seq as number, 'up');
    expect(mac.sent.at(-1)).toEqual({ react: `messages/${m.seq}/react`, emoji: '👍' });
    expect(session.reactions.get(m.seq as number)).toBe('up');
    expect(session.toast?.text).toBe('좋았다고 전했어요. 이런 걸 더 할게요.');
  });
});

describe('choiceClientId', () => {
  it('stays within the Mac\'s 64 characters and the same for the same choice', () => {
    expect(choiceClientId(12, 'yes')).toBe('choice-12-yes');
    const long = 'company.approve:3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';
    const a = choiceClientId(123456, long);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(choiceClientId(123456, long)).toBe(a);
    expect(choiceClientId(123456, long.replace('approve', 'decline'))).not.toBe(a);
  });
});
