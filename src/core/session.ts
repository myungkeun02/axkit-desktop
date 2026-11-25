import { setTimeZone } from './format';
import { ApiClient, ApiError, errorText, hasFeature, hasView, type Capabilities, type Transport } from './api';
import { answerFor, type CardAnswer } from './cards';
import { ActivityBoard, decodeActivity } from './activity';
import { decodeEvent, type AppEvent, type CardEvent, type CardOption, type Choice } from './events';
import { Outbox, type OutboxStorage, type Pending } from './outbox';
import { Timeline } from './timeline';
import { channelsOf, type BotsView, type Channel } from './views';
import { decodeWork, type WorkView } from './work';
import { decodePlan, type PlanStatus } from './teamPlan';
import { decodeFirstLook, type LookStatus } from './firstLook';
import { decodeDesktopBuild, decodeReleaseBuild, pickUpdate, type DesktopBuild } from './appUpdate';

// Everything the screens share: connection, the live stream, catch-up, the timeline and the outbox.
// No React and no Tauri here — the platform is passed in, so this is tested with fakes.

export interface ConnInfo {
  /** local = this Mac's ax-kit (token file), remote = another Mac paired over Tailscale, mock = development. */
  mode: 'local' | 'mock' | 'remote';
  connected: boolean;
  host?: string | null;
  problem?: string | null;
  tokenFile?: string | null;
  devBuild: boolean;
  /** Remote: the name the other Mac gave this device. */
  deviceName?: string | null;
  /** This Mac has its own ax-kit (its token file exists). */
  localAvailable?: boolean;
}

/** "다른 맥의 비서에 연결": the `axkit://pair?…` link, or the three values typed by hand. */
export type PairInput = { link: string } | { address: string; code: string; nonce: string };

export type StreamStateName = 'connecting' | 'live' | 'waiting' | 'unauthorized' | 'stopped';

export interface Platform {
  transport: Transport;
  connection(): Promise<ConnInfo>;
  reconnect(): Promise<ConnInfo>;
  useMock(baseUrl: string): Promise<ConnInfo>;
  useLocal(): Promise<ConnInfo>;
  streamStart(after: number, reset: boolean): Promise<void>;
  streamStop(): Promise<void>;
  /** Returns an unsubscribe function. */
  onStreamEvent(cb: (data: string) => void): Promise<() => void>;
  onStreamState(cb: (state: StreamStateName, retryInSec?: number) => void): Promise<() => void>;
  /** Pair with another Mac; rejects with plain Korean. The token stays in Rust (Keychain). */
  pairRemote(input: PairInput): Promise<ConnInfo>;
  /** Stop using the other Mac and go back to this Mac's ax-kit. */
  forgetRemote(): Promise<ConnInfo>;
  /** Some window switched servers (paired, forgot, mock, local): every window starts over. */
  onServerChanged(cb: () => void): Promise<() => void>;
  /** Focus, wake, network change: retry the stream now, restart it if it went quiet. */
  nudge(): Promise<void>;
}

/** Which rooms the owner has read, kept per server so a restart remembers them. */
export interface ReadStorage { load(scope: string): Record<string, number>; save(scope: string, upTo: Record<string, number>): void }

/** clientId for a choice: the same every time (a resend is stored once), never longer than the Mac's 64.
 *  Choice ids like `company.approve:<uuid>` are long, so a long one is replaced by its FNV-1a hash. */
export function choiceClientId(seq: number, id: string): string {
  const plain = `choice-${seq}-${id}`;
  if (plain.length <= 64) return plain;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let h2 = 0x01000193;
  for (let i = id.length - 1; i >= 0; i--) { h2 ^= id.charCodeAt(i); h2 = Math.imul(h2, 0x811c9dc5) >>> 0; }
  return `choice-${seq}-${h.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export type Connection = 'none' | 'connecting' | 'live' | 'offline' | 'unauthorized';

export const connectionLabel: Record<Connection, string> = {
  none: '연결 안 됨',
  connecting: '연결하는 중',
  live: '연결됨',
  offline: '맥의 ax-kit에 닿지 않아요',
  unauthorized: '다시 연결이 필요해요',
};

export class Session {
  readonly api: ApiClient;
  timeline = new Timeline();
  /** §4 `activity`: rooms where the assistant is thinking or working right now (not in the log). */
  readonly activity = new ActivityBoard();
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  readonly outbox: Outbox;
  capabilities: Capabilities = { features: [], views: [] };
  assistantName = '비서';
  stopped = false;
  bots: BotsView | null = null;
  /** §24: the team-structure proposal's status, or null when the server has none (or no `team-plan`). */
  teamPlan: PlanStatus | null = null;
  /** §27 처음 알아보기's status (null = unknown or no such view): the sidebar drops the entry once it is `done`. */
  firstLook: LookStatus | null = null;
  /** Bumped when the team plan may have changed elsewhere (a chat revision, a card): open plan screens read it again. */
  planRev = 0;
  /** §28 `views/work`: what the assistant is doing in the background and what finished lately (null = no such view). */
  work: WorkView | null = null;
  /** ax-hq `channels` view: all rooms with labels and whether the owner may write there. */
  channels: Channel[] = [];
  connection: Connection = 'connecting';
  /** §32: this app's build number (stamped at build time; 0 = a dev build, which never offers an update). */
  appBuild = 0;
  /** §32: a newer build of this app the Mac offers, or null. */
  update: DesktopBuild | null = null;
  info: ConnInfo | null = null;
  toast: { text: string; id: number } | null = null;
  /** The 결재 the owner last pointed at (from a chat line), so the 결재 screen opens on it. */
  selectedCard: string | null = null;
  /** Bumped on every change; React reads it with useSyncExternalStore. */
  version = 0;

  private listeners = new Set<() => void>();
  private unsubs: (() => void)[] = [];
  private catchingUp = false;
  /** When connect() opened the stream: its first "live" needs no second refresh. */
  private connectedAt = 0;
  /** When this window switched servers itself (the server-changed event it causes is ignored). */
  private switchedAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 0;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Choices already sent (seq:choice), so a double click sends once. */
  readonly chosen = new Set<string>();

  constructor(private readonly platform: Platform, storage: OutboxStorage, private readonly reads?: ReadStorage) {
    this.api = new ApiClient(platform.transport);
    this.outbox = new Outbox(storage);
  }

  /** Each server keeps its own outbox and read marks. */
  get scope(): string {
    const i = this.info;
    if (!i || i.mode === 'local') return 'local';
    return `${i.mode}:${i.host ?? ''}`;
  }

  private applyScope() {
    this.outbox.useScope(this.scope);
    const saved = this.reads?.load(this.scope) ?? {};
    for (const [room, upTo] of Object.entries(saved)) {
      if (typeof upTo === 'number') this.timeline.readUpTo.set(room, Math.max(this.timeline.readUpTo.get(room) ?? 0, upTo));
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getVersion = () => this.version;

  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Screens redraw at most once a frame: a burst of stream events (a reconnect replays hundreds) used to redraw
   *  every room line once per event. */
  changed() {
    this.version++;
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const l of this.listeners) l();
    }, 16);
  }

  say(text: string) {
    this.toast = { text, id: Date.now() };
    this.changed();
  }

  // MARK: lifecycle

  /** `autoReconnect` (the main window): while this Mac's ax-kit is not running yet, look for it every few seconds. */
  async start(opts: { autoReconnect?: boolean } = {}) {
    this.unsubs.push(await this.platform.onStreamEvent((data) => this.receive(data)));
    this.unsubs.push(await this.platform.onStreamState((state) => this.streamState(state)));
    this.unsubs.push(await this.platform.onServerChanged(() => { if (Date.now() - this.switchedAt > 3000) void this.serverChanged(); }));
    this.info = await this.platform.connection();
    this.applyScope();
    this.changed();
    await this.connect(false);
    if (opts.autoReconnect) {
      let busy = false;
      this.autoTimer = setInterval(() => {
        if (busy || this.connection !== 'none' || this.info?.mode !== 'local') return;
        busy = true;
        void this.reconnect().finally(() => { busy = false; });
      }, 4000);
    }
  }

  /** Another window switched servers. */
  private async serverChanged() {
    this.info = await this.platform.connection();
    await this.startOver();
  }

  async stop() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.activityTimer !== null) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    this.activity.clear();
    if (this.autoTimer !== null) clearInterval(this.autoTimer);
    this.autoTimer = null;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.platform.streamStop();
  }

  /** The window came to the front, the Mac woke up, the network changed. */
  async nudge() {
    await this.platform.nudge().catch(() => {});
    if (this.connection === 'live') { await this.catchUp(); void this.flushOutbox(); }
  }

  /** (Re)load basics, catch up, open the stream. */
  async connect(reset: boolean) {
    if (!this.info?.connected) {
      this.connection = 'none';
      this.changed();
      return;
    }
    this.connection = 'connecting';
    this.changed();
    const fresh = await this.refreshBasics();
    await this.catchUp();
    this.connectedAt = Date.now();
    await this.platform.streamStart(this.timeline.lastSeq, reset || fresh);
    await this.flushOutbox();
  }

  async reconnect() {
    await this.platform.streamStop();
    this.info = await this.platform.reconnect();
    this.applyScope();
    await this.connect(false);
  }

  async switchTo(target: { mock: string } | 'local') {
    this.switchedAt = Date.now();
    let info: ConnInfo;
    try {
      info = target === 'local' ? await this.platform.useLocal() : await this.platform.useMock(target.mock);
    } catch (e) {
      this.say(errorText(e));
      return;
    }
    await this.platform.streamStop();
    this.info = info;
    await this.startOver();
  }

  /** Another server: nothing from the old one may stay on screen. */
  private async startOver() {
    this.timeline = new Timeline();
    this.bots = null;
    this.channels = [];
    this.work = null;
    this.teamPlan = null;
    this.firstLook = null;
    this.activity.clear();
    this.chosen.clear();
    this.capabilities = { features: [], views: [] };
    this.applyScope();
    await this.connect(true);
  }

  /** Throws the reason in plain Korean when pairing fails (the old connection stays as it was). */
  async pairRemote(input: PairInput) {
    this.switchedAt = Date.now();
    const info = await this.platform.pairRemote(input).catch((e: unknown) => { throw new Error(typeof e === 'string' ? e : errorText(e)); });
    await this.platform.streamStop();
    this.info = info;
    await this.startOver();
  }

  async forgetRemote() {
    this.switchedAt = Date.now();
    await this.platform.streamStop();
    this.info = await this.platform.forgetRemote();
    await this.startOver();
  }

  /** Returns true when the timeline was started over (the server's log restarted). */
  async refreshBasics(): Promise<boolean> {
    let fresh = false;
    try {
      this.capabilities = await this.api.capabilities();
      const status = await this.api.status();
      // A server whose log started over (new install, wiped data): start the timeline over too.
      if (status.lastSeq < this.timeline.lastSeq) {
        this.timeline = new Timeline();
        fresh = true;
      }
      this.assistantName = status.assistant.name;
      setTimeZone(status.assistant.timezone);
      this.stopped = status.stopped === true;
      if (hasView(this.capabilities, 'bots')) this.bots = await this.api.view<BotsView>('bots').catch(() => this.bots);
      await this.refreshTeamPlan(false);
      await this.refreshFirstLook(false);
      await this.refreshWork(false);
      await this.refreshUpdate(false);
      if (hasView(this.capabilities, 'channels')) this.channels = await this.api.view<unknown>('channels').then(channelsOf).catch(() => this.channels);
    } catch (e) {
      this.handle(e);
    }
    this.changed();
    return fresh;
  }

  async refreshFirstLook(redraw = true) {
    if (!hasFeature(this.capabilities, 'first-look') || !hasView(this.capabilities, 'first-look')) { this.firstLook = null; return; }
    try { this.noteFirstLook(decodeFirstLook(await this.api.view('first-look'))?.status ?? null, redraw); } catch { /* keep what we had */ }
  }

  /** The first-look screen reads the view itself; it tells the sidebar what it saw. */
  noteFirstLook(status: LookStatus | null, redraw = true) {
    if (status !== this.firstLook) { this.firstLook = status; if (redraw) this.changed(); }
  }

  async refreshTeamPlan(redraw = true) {
    if (!hasFeature(this.capabilities, 'team-plan') || !hasView(this.capabilities, 'team-plan')) { this.teamPlan = null; return; }
    try {
      const status = decodePlan(await this.api.view('team-plan'))?.status ?? null;
      if (status !== this.teamPlan) { this.teamPlan = status; if (redraw) this.changed(); }
    } catch { /* keep what we had */ }
  }

  /** The public GitHub release check (set in main.tsx inside the app; absent in the browser preview). */
  checkRelease: (() => Promise<unknown>) | null = null;
  /** What the last check of each source found (a failed check keeps the last answer). */
  private offers: { mac: DesktopBuild | null; github: DesktopBuild | null } = { mac: null, github: null };

  /** §32 and the GitHub release: at start, after a reconnect and once a day (main.tsx). */
  async refreshUpdate(redraw = true) {
    const mac = hasFeature(this.capabilities, 'app-updates')
      ? this.api.view('app-updates').then((d) => { const b = decodeDesktopBuild(d); return b ? { ...b, source: 'mac' as const } : null; }, () => this.offers.mac)
      : Promise.resolve(null);
    const github = this.checkRelease ? this.checkRelease().then(decodeReleaseBuild, () => this.offers.github) : Promise.resolve(null);
    const [m, g] = await Promise.all([mac, github]);
    this.offers = { mac: m, github: g };
    const next = pickUpdate(m, g, this.appBuild);
    if (next?.build !== this.update?.build || next?.source !== this.update?.source) { this.update = next; if (redraw) this.changed(); }
  }

  async refreshWork(redraw = true) {
    if (!hasView(this.capabilities, 'work')) { this.work = null; return; }
    try {
      this.work = decodeWork(await this.api.view('work'));
      if (redraw) this.changed();
    } catch { /* keep what we had */ }
  }

  /** 정지·비서 이름 (status), and bots/channels: a notice may mean they changed. A burst becomes one refresh. */
  refreshSoon() {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void (async () => {
        try {
          const status = await this.api.status();
          this.assistantName = status.assistant.name;
          this.stopped = status.stopped === true;
        } catch { /* the stream will say */ }
        await this.refreshBots();
      })();
    }, 1500);
  }

  async refreshBots() {
    if (!hasView(this.capabilities, 'bots')) return;
    this.bots = await this.api.view<BotsView>('bots').catch(() => this.bots);
    if (hasView(this.capabilities, 'channels')) this.channels = await this.api.view<unknown>('channels').then(channelsOf).catch(() => this.channels);
    this.changed();
  }

  /** `events?after=` until the gap is filled (§3). Safe to run while the stream delivers the same events. */
  async catchUp() {
    if (this.catchingUp) return;
    this.catchingUp = true;
    try {
      for (let page = 0; page < 20; page++) {
        const result = await this.api.events(this.timeline.lastSeq, 200);
        const added = this.timeline.applyAll(result.events);
        for (const e of result.events) this.answeredIn(e);
        if (added) this.changed();
        if (result.events.length < 200) break;
      }
    } catch (e) {
      this.handle(e);
    } finally {
      this.catchingUp = false;
    }
  }

  /** Called for each new event that arrives live on the stream (not catch-up history) — notifications hook here. */
  onLiveEvent: ((event: AppEvent) => void) | null = null;

  receive(data: string) {
    let raw: unknown;
    try { raw = JSON.parse(data); } catch { return; }
    const act = decodeActivity(raw);
    if (act) {
      if (hasFeature(this.capabilities, 'activity') && this.activity.apply(act)) { this.scheduleActivityExpiry(); this.changed(); }
      return;
    }
    const event = decodeEvent(raw);
    if (!event) return;
    // A card sent again with the same id (R15) replaces the old one; it is not news worth a second notification.
    const resent = event.type === 'card' && this.timeline.cards.has(event.cardId);
    if (!this.timeline.apply(event)) return;
    this.answeredIn(event);
    this.changed();
    if (!resent) this.onLiveEvent?.(event);
    if (event.type === 'notice') this.refreshSoon();
    // A proposal is made, built or dropped with a notice in the chat (or the card): look again.
    if ((event.type === 'notice' || event.type === 'card' || event.type === 'card_closed') && hasFeature(this.capabilities, 'team-plan')) { this.planRev++; void this.refreshTeamPlan(); }
    // §28/§31: a long task started ("시작했어요…") or any notice (a job finished, a bot took one): look again.
    if (event.type === 'notice' || (event.type === 'message' && event.role === 'assistant' && /작업 [\w:-]+\)|끝나면 알려/.test(event.text))) void this.refreshWork();
    if (event.type === 'delegation' && hasView(this.capabilities, 'bots')) {
      void this.api.view<BotsView>('bots').then((b) => { this.bots = b; this.changed(); }).catch(() => {});
    }
  }

  /** An assistant reply in a room replaces its "생각하는 중…". */
  private answeredIn(event: AppEvent) {
    if (event.type === 'message' && event.role === 'assistant' && this.activity.answered(event.channel ?? '', Date.parse(event.at))) this.changed();
  }

  /** Wakes once when the next activity runs out (3 minutes without news), so the dots never stay forever. */
  private scheduleActivityExpiry() {
    if (this.activityTimer !== null) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    const next = this.activity.nextExpiry();
    if (next === null) return;
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null;
      if (this.activity.expire()) this.changed();
      this.scheduleActivityExpiry();
    }, Math.max(next - Date.now(), 0) + 50);
  }

  private streamState(state: StreamStateName) {
    const before = this.connection;
    switch (state) {
      case 'connecting': if (this.connection !== 'live') this.connection = 'connecting'; break;
      case 'live': this.connection = 'live'; break;
      // No connection: nobody can be "생각하는 중" for us any more.
      case 'waiting': this.connection = 'offline'; this.activity.clear(); break;
      case 'unauthorized': this.connection = 'unauthorized'; this.activity.clear(); break;
      case 'stopped': break;
    }
    this.changed();
    if (state === 'live' && before !== 'live') {
      void this.platform.connection().then((i) => { this.info = i; this.changed(); });
      // The stream came back on its own (sleep, Wi-Fi, a restarted Mac): look at everything again.
      if (Date.now() - this.connectedAt > 10_000) void this.resync();
      else void this.flushOutbox();
    }
  }

  /** After a reconnect: basics, the gap, and a log that started over (D9: seq from 0 again) restarts the stream from there. */
  private async resync() {
    const fresh = await this.refreshBasics();
    if (fresh) this.applyScope();
    await this.catchUp();
    if (fresh) { this.connectedAt = Date.now(); await this.platform.streamStart(this.timeline.lastSeq, true); }
    await this.flushOutbox();
  }

  private handle(e: unknown) {
    if (e instanceof ApiError) {
      if (e.kind === 'unauthorized') this.connection = 'unauthorized';
      else if (e.kind === 'offline') this.connection = 'offline';
    }
    this.changed();
  }

  // MARK: chat

  send(text: string, room: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.outbox.enqueue(trimmed, room);
    this.changed();
    void this.flushOutbox();
  }

  pendingIn(room: string): readonly Pending[] { return this.outbox.pending.filter((p) => p.channel === room); }

  /** 다시 보내기 on a message the Mac refused. */
  resend(id: string) { this.outbox.retry(id); this.changed(); void this.flushOutbox(); }
  /** 지우기 on a message the Mac refused. */
  discard(id: string) { this.outbox.remove(id); this.changed(); }

  async flushOutbox() {
    if (!this.outbox.waiting.length || !this.info?.connected) return;
    const result = await this.outbox.flush(
      async (p) => { await this.api.sendMessage({ text: p.text, channel: p.channel, clientId: p.id }); },
      // Offline, busy (429/503) or a token being replaced (401): wait. Anything else: the Mac said no — keep it, marked.
      (e) => (!(e instanceof ApiError) || e.transient || e.kind === 'unauthorized' ? { wait: true } : { wait: false, reason: errorText(e) }),
    );
    if (result.failed.length) this.say('보내지 못한 메시지가 있어요. 대화에서 다시 보내거나 지울 수 있어요.');
    this.changed();
    if (result.waiting) this.scheduleRetry();
    else this.retryDelay = 0;
    if (result.sent.length) await this.catchUp();
  }

  /** Still waiting while the stream is up (429/503): try again after 2 s, 4 s, … up to a minute. */
  private scheduleRetry() {
    if (this.retryTimer !== null) return;
    this.retryDelay = Math.min(Math.max(this.retryDelay * 2, 2), 60);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flushOutbox(); }, this.retryDelay * 1000);
  }

  /** A choice under a line: sent once (the same clientId if it is ever sent again), then the buttons are done. */
  async choose(choice: Choice, room: string, seq?: number) {
    const key = `${seq ?? 'x'}:${choice.id}`;
    if (this.chosen.has(key)) return;
    this.chosen.add(key);
    this.changed();
    try {
      await this.api.sendMessage({ choice: choice.id, channel: room, ...(seq !== undefined ? { clientId: choiceClientId(seq, choice.id) } : {}) });
      await this.catchUp();
    } catch (e) {
      this.chosen.delete(key);
      this.changed();
      this.say(errorText(e));
    }
  }

  // MARK: cards

  get cardReplyAllowed() { return this.capabilities.features.includes('card-reply'); }

  /** Answer a 결재. Returns true when the card is done. */
  async answer(card: CardEvent, answer: CardAnswer, remember = false, option?: CardOption): Promise<boolean> {
    // A server without `card-reply`: answer "edit" (this action is declined, the assistant asks what to change)
    // and send the owner's words to the same room so nothing typed is lost.
    if ('text' in answer && !this.cardReplyAllowed) {
      try {
        const result = await this.api.answerCard(card.cardId, { decision: 'edit' });
        this.timeline.closeLocally(card.cardId, result.state, answer.text);
        this.send(`[결재 답: ${card.summary}] ${answer.text}`, card.channel ?? '');
        this.changed();
        return true;
      } catch (e) {
        this.say(errorText(e));
        return false;
      }
    }
    try {
      const result = await this.api.answerCard(card.cardId, answer, remember, option);
      if (result.state === 'open') {
        this.say(result.reply ?? '아직 처리 중이에요.');
        return false;
      }
      const label = 'text' in answer ? answer.text : undefined;
      this.timeline.closeLocally(card.cardId, result.state, label);
      if (remember && option?.tone !== 'danger' && !('text' in answer)) this.say('앞으로 이런 일은 알아서 할게요');
      // The Mac often echoes the owner's own words back as the reply: no need to show them again.
      else if (result.reply && result.reply.trim() !== label?.trim()) this.say(result.reply);
      this.changed();
      // Building a team plan from its card makes new bots and rooms.
      if (card.topic?.startsWith('bots:team-plan')) { void this.refreshTeamPlan(); void this.refreshBots(); }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'gone') {
        this.timeline.closeLocally(card.cardId, 'closed');
        this.say(e.message);
        return false;
      }
      this.say(errorText(e));
      return false;
    }
  }

  answerOption(card: CardEvent, option: CardOption, remember: boolean) {
    return this.answer(card, answerFor(option), remember, option);
  }

  // MARK: reactions (feature `reactions`)

  /** What the owner said about a bot message this session: up = 이런 거 더, down = 이런 거 덜. */
  readonly reactions = new Map<number, 'up' | 'down'>();

  async react(seq: number, kind: 'up' | 'down') {
    try {
      await this.api.react(seq, kind === 'up' ? '👍' : '👎');
      this.reactions.set(seq, kind);
      this.say(kind === 'up' ? '좋았다고 전했어요. 이런 걸 더 할게요.' : '별로였다고 전했어요. 이런 건 덜 할게요.');
    } catch (e) {
      this.say(errorText(e));
    }
    this.changed();
  }

  // MARK: rooms

  roomTitle(room: string) {
    if (!room) return this.assistantName;
    return this.bots?.groups.flatMap((g) => g.bots).find((b) => b.channel === room)?.name ?? this.channels.find((c) => c.id === room)?.label ?? room;
  }

  /** Rooms the server marks read-only (ax-hq company rooms like 브리핑·장애·로그). */
  canWrite(room: string) {
    return this.channels.find((c) => c.id === room)?.writable !== false;
  }

  /** Only when the owner can see the room (the screen checks the window is visible and in front). */
  markRead(room: string) {
    const before = this.timeline.readUpTo.get(room);
    this.timeline.markRead(room);
    const upTo = this.timeline.readUpTo.get(room) ?? 0;
    if (before !== upTo) {
      this.changed();
      this.reads?.save(this.scope, Object.fromEntries(this.timeline.readUpTo));
      if (upTo > (before ?? 0) && this.capabilities.features.includes('read-sync')) void this.api.markRead(room, upTo).catch(() => {});
    }
  }
}
