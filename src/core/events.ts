// App protocol v1 events (ax-kit docs/APP-PROTOCOL.md §4, §7, §8, §9). Fields the server may leave out are optional
// and unknown fields are ignored, so a newer server keeps working with this app.

export interface Choice { id: string; label: string }
export interface Author { id: string; name: string; avatar?: string }
export interface Attachment { id: string; name: string; contentType: string; size?: number; url: string }
export interface EventLink { label: string; url: string }
export type Tone = 'primary' | 'danger' | 'neutral';
export interface CardOption { id: string; label: string; tone?: Tone; detail?: string }
export interface RememberOffer { label: string; detail?: string }

interface Base { seq: number; at: string; channel?: string }

/** §21.3: a piece of work, a pipeline step or a meeting; its lines share the id, the first has `start`. */
export interface EventThread { id: string; title?: string; start?: boolean }

export interface ReactionEvent extends Base { type: 'reaction'; target: number; emoji: string; by?: Author }
export interface ReadEvent extends Base { type: 'read'; upTo: number }

export interface LiveHint { view: string; reason: string; url?: string }

export interface MessageEvent extends Base {
  type: 'message';
  role: 'assistant' | 'owner';
  text: string;
  choices?: Choice[];
  author?: Author;
  /** R17: who a bot was talking to (team and meeting rooms). */
  to?: Author;
  thread?: EventThread;
  attachments?: Attachment[];
  imageUrl?: string;
  /** §22: this reply handed a browser page over (newer servers; older ones only say so in the text). */
  live?: LiveHint;
  links?: EventLink[];
}

export interface NoticeEvent extends Base {
  type: 'notice';
  text: string;
  /** §28: what this is about ("dev.job", "browser.task", "errands.task", "work.interrupted", …). */
  kind?: string;
  /** §28: a browser task stopped at a step for the owner — same as a reply's `live` (§22). */
  live?: LiveHint;
  choices?: Choice[];
  author?: Author;
  thread?: EventThread;
  attachments?: Attachment[];
  imageUrl?: string;
  links?: EventLink[];
}

export interface CardEvent extends Base {
  type: 'card';
  cardId: string;
  summary: string;
  effects: string[];
  effectLabels: string[];
  note?: string;
  expiresAt?: string;
  options?: CardOption[];
  /** `false` = buttons only (§7.3). */
  freeText?: boolean;
  amount?: { value: number; currency: string };
  merchant?: string;
  /** R11: "앞으로는 알아서" offer. */
  remember?: RememberOffer;
  /** R15: same topic = same question. */
  topic?: string;
  author?: Author;
  attachments?: Attachment[];
  imageUrl?: string;
}

export interface CardClosedEvent extends Base {
  type: 'card_closed';
  cardId: string;
  state: string;
  answer?: string;
}

export interface DelegationEvent extends Base {
  type: 'delegation';
  bot: Author;
  botChannel: string;
  task: string;
  state: 'started' | 'done' | 'failed';
  summary?: string;
}

export interface UnknownEvent extends Base { type: 'unknown'; rawType: string }

export type AppEvent = MessageEvent | NoticeEvent | CardEvent | CardClosedEvent | DelegationEvent | ReactionEvent | ReadEvent | UnknownEvent;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => (str(v) ? v : undefined);

function choices(v: unknown): Choice[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((c) => isObj(c) && str(c.id) && str(c.label)).map((c) => ({ id: c.id as string, label: c.label as string }));
  return list.length ? list : undefined;
}

function author(v: unknown): Author | undefined {
  if (!isObj(v) || !str(v.id)) return undefined;
  return { id: v.id, name: str(v.name) ? v.name : v.id, avatar: optStr(v.avatar) };
}

function attachments(v: unknown): Attachment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((a) => isObj(a) && str(a.id) && str(a.url)).map((a) => ({
    id: a.id as string, name: optStr(a.name) ?? '첨부', contentType: optStr(a.contentType) ?? 'application/octet-stream',
    size: typeof a.size === 'number' ? a.size : undefined, url: a.url as string,
  }));
  return list.length ? list : undefined;
}

function links(v: unknown): EventLink[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((l) => isObj(l) && str(l.label) && str(l.url)).map((l) => ({ label: l.label as string, url: l.url as string }));
  return list.length ? list : undefined;
}

function options(v: unknown): CardOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((o) => isObj(o) && str(o.id)).map((o) => {
    const tone = o.tone === 'primary' || o.tone === 'danger' || o.tone === 'neutral' ? o.tone : undefined;
    return { id: o.id as string, label: optStr(o.label) ?? (o.id as string), tone, detail: optStr(o.detail) } as CardOption;
  });
  return list.length ? list : undefined;
}

function thread(v: unknown): EventThread | undefined {
  return isObj(v) && str(v.id) ? { id: v.id, title: optStr(v.title), start: v.start === true ? true : undefined } : undefined;
}

function liveHint(raw: unknown): LiveHint | undefined {
  if (!isObj(raw) || !str(raw.view)) return undefined;
  return { view: raw.view, reason: str(raw.reason) ? raw.reason : 'other', url: optStr(raw.url) };
}

/** One event from parsed JSON, or null when it is not an event at all. Unknown types and broken known types become
 * `unknown` (kept only for their seq) so one bad event never stops the stream. */
export function decodeEvent(raw: unknown): AppEvent | null {
  if (!isObj(raw) || !str(raw.type) || typeof raw.seq !== 'number' || !Number.isFinite(raw.seq)) return null;
  const base: Base = { seq: raw.seq, at: str(raw.at) ? raw.at : new Date(0).toISOString(), channel: optStr(raw.channel) };
  const unknown: UnknownEvent = { ...base, type: 'unknown', rawType: raw.type };
  switch (raw.type) {
    case 'message':
      if (!str(raw.text) || (raw.role !== 'assistant' && raw.role !== 'owner')) return unknown;
      return { ...base, type: 'message', role: raw.role, text: raw.text, choices: choices(raw.choices), author: author(raw.author), to: author(raw.to), thread: thread(raw.thread),
        attachments: attachments(raw.attachments), imageUrl: optStr(raw.imageUrl), links: links(raw.links), live: liveHint(raw.live) };
    case 'notice':
      if (!str(raw.text)) return unknown;
      return { ...base, type: 'notice', text: raw.text, choices: choices(raw.choices), author: author(raw.author), thread: thread(raw.thread),
        attachments: attachments(raw.attachments), imageUrl: optStr(raw.imageUrl), links: links(raw.links), kind: optStr(raw.kind), live: liveHint(raw.live) };
    case 'card': {
      if (!str(raw.cardId) || !str(raw.summary)) return unknown;
      const effects = Array.isArray(raw.effects) ? raw.effects.filter(str) : [];
      const amount = isObj(raw.amount) && typeof raw.amount.value === 'number' && str(raw.amount.currency)
        ? { value: raw.amount.value, currency: raw.amount.currency } : undefined;
      const remember = isObj(raw.remember) && str(raw.remember.label) ? { label: raw.remember.label, detail: optStr(raw.remember.detail) } : undefined;
      return { ...base, type: 'card', cardId: raw.cardId, summary: raw.summary, effects,
        effectLabels: Array.isArray(raw.effectLabels) ? raw.effectLabels.filter(str) : [], note: optStr(raw.note), expiresAt: optStr(raw.expiresAt),
        options: options(raw.options), freeText: typeof raw.freeText === 'boolean' ? raw.freeText : undefined, amount,
        merchant: optStr(raw.merchant), remember, topic: optStr(raw.topic), author: author(raw.author),
        attachments: attachments(raw.attachments), imageUrl: optStr(raw.imageUrl) };
    }
    case 'card_closed':
      if (!str(raw.cardId) || !str(raw.state)) return unknown;
      return { ...base, type: 'card_closed', cardId: raw.cardId, state: raw.state, answer: optStr(raw.answer) };
    case 'delegation': {
      const bot = author(raw.bot);
      if (!bot || !str(raw.botChannel) || !str(raw.task)) return unknown;
      const state = raw.state === 'done' || raw.state === 'failed' ? raw.state : 'started';
      return { ...base, type: 'delegation', bot, botChannel: raw.botChannel, task: raw.task, state, summary: optStr(raw.summary) };
    }
    case 'reaction':
      if (typeof raw.target !== 'number' || !str(raw.emoji)) return unknown;
      return { ...base, type: 'reaction', target: raw.target, emoji: raw.emoji, by: author(raw.by) };
    case 'read':
      if (typeof raw.upTo !== 'number') return unknown;
      return { ...base, type: 'read', upTo: raw.upTo };
    default:
      return unknown;
  }
}

export function decodeEventText(text: string): AppEvent | null {
  try { return decodeEvent(JSON.parse(text)); } catch { return null; }
}

/** Room id; "" is the main chat. */
export const roomOf = (e: AppEvent) => e.channel ?? '';

/** Same question = same topic, or (without one) the same context and question text. */
export const questionKey = (c: CardEvent) => c.topic ?? `${c.note ?? ''}\u001f${c.summary}`;

export const isPayment = (c: CardEvent) => c.effects.includes('pay') || c.amount !== undefined;
