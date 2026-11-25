import { cardBody, cardPath, type CardAnswer } from './cards';
import { decodeEvent, type AppEvent, type CardOption } from './events';

// The protocol client. It never sees the token: every call goes through a Transport (the Tauri commands in
// src-tauri/src/lib.rs in the app, a fake in tests).

export interface RawReply { status: number; body: unknown }

export interface Transport {
  call(method: 'GET' | 'POST', path: string, query?: Record<string, string>, body?: unknown): Promise<RawReply>;
  upload(path: string, bytes: Uint8Array, headers: Record<string, string>): Promise<RawReply>;
}

export type ApiErrorKind = 'unauthorized' | 'gone' | 'rateLimited' | 'notFound' | 'badRequest' | 'server' | 'offline' | 'decoding';

export class ApiError extends Error {
  /** The Mac's own plain-language reason, when it sends one (`{ok:false, error, message}`). */
  serverMessage?: string;
  constructor(readonly kind: ApiErrorKind, readonly status = 0, readonly code?: string, serverMessage?: string) {
    super(serverMessage ?? friendly(kind));
    this.serverMessage = serverMessage;
  }
  /** Worth retrying later (the outbox keeps the message). */
  get transient() { return this.kind === 'offline' || this.kind === 'rateLimited' || this.kind === 'server'; }
}

export function friendly(kind: ApiErrorKind): string {
  switch (kind) {
    case 'unauthorized': return '맥이 이 앱의 연결을 받지 않아요. ax-kit를 다시 켜 주세요.';
    case 'gone': return '이미 처리된 결재예요.';
    case 'rateLimited': return '잠깐 너무 많이 보냈어요. 조금 뒤에 다시 해 주세요.';
    case 'notFound': return '맥에 아직 이 기능이 없어요.';
    case 'badRequest': return '보낸 내용을 맥이 이해하지 못했어요.';
    case 'server': return '맥이 잠깐 대답을 못 해요. 조금 뒤에 다시 해 볼게요.';
    case 'offline': return '맥의 ax-kit에 닿지 않아요. ax-kit가 켜져 있는지 확인해 주세요.';
    case 'decoding': return '맥이 보낸 내용을 읽지 못했어요.';
  }
}

/** Words for the screen. `refused` replaces the generic "맥이 이해하지 못했어요" for a 400 without the Mac's own reason. */
export const errorText = (e: unknown, refused?: string) => {
  if (e instanceof ApiError) return e.serverMessage ?? (e.kind === 'badRequest' && refused ? refused : e.message);
  return typeof e === 'string' ? e : '잠깐 문제가 생겼어요. 다시 해 볼게요.';
};

export interface ViewInfo { name: string; version: number; actions?: string[]; title?: string; icon?: string; ui?: string }
export interface Capabilities { protocol?: number; server?: string; local?: boolean; features: string[]; views: ViewInfo[] }
export interface ServerStatus {
  protocol?: number;
  assistant: { name: string; language?: string; timezone?: string };
  lastSeq: number;
  serverTime?: string;
  stopped?: boolean;
}
export interface EventsPage { events: AppEvent[]; lastSeq: number; oldestSeq: number }
export interface CardResult { state: string; reply?: string; answer?: string }

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

export class ApiClient {
  constructor(private readonly transport: Transport) {}

  private check(reply: RawReply): Record<string, unknown> {
    const body = obj(reply.body);
    const s = reply.status;
    if (s >= 200 && s < 300) return body;
    const code = typeof body.error === 'string' ? body.error : undefined;
    const said = typeof body.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 300) : undefined;
    // Only the Mac's own JSON 401 counts as "not allowed"; anything else (no JSON) is treated like being offline.
    if (s === 401) throw new ApiError(reply.body === null ? 'offline' : 'unauthorized', s, code);
    if (s === 404) throw new ApiError('notFound', s, code);
    if (s === 410) throw new ApiError('gone', s, code);
    if (s === 429) throw new ApiError('rateLimited', s, code);
    if (s === 400 || s === 413) throw new ApiError('badRequest', s, code, said);
    if (s === 0) throw new ApiError('offline', s, code);
    throw new ApiError('server', s, code, said);
  }

  private async get(path: string, query?: Record<string, string>) {
    let reply: RawReply;
    try { reply = await this.transport.call('GET', path, query); } catch (e) { throw toApiError(e); }
    return this.check(reply);
  }

  private async post(path: string, body: unknown) {
    let reply: RawReply;
    try { reply = await this.transport.call('POST', path, undefined, body); } catch (e) { throw toApiError(e); }
    return this.check(reply);
  }

  async capabilities(): Promise<Capabilities> {
    const b = await this.get('capabilities');
    const features = Array.isArray(b.features) ? b.features.filter((f): f is string => typeof f === 'string') : [];
    const views = Array.isArray(b.views) ? (b.views.filter((v) => typeof obj(v).name === 'string') as ViewInfo[]) : [];
    return { protocol: b.protocol as number | undefined, server: b.server as string | undefined, local: b.local as boolean | undefined, features, views };
  }

  async status(): Promise<ServerStatus> {
    const b = await this.get('status');
    const assistant = obj(b.assistant);
    if (typeof b.lastSeq !== 'number') throw new ApiError('decoding');
    return { protocol: b.protocol as number, assistant: { name: typeof assistant.name === 'string' ? assistant.name : '비서', timezone: assistant.timezone as string | undefined },
      lastSeq: b.lastSeq, serverTime: b.serverTime as string | undefined, stopped: b.stopped === true };
  }

  async events(after: number, limit = 200, channel?: string): Promise<EventsPage> {
    const query: Record<string, string> = { after: String(after), limit: String(limit) };
    if (channel !== undefined) query.channel = channel;
    const b = await this.get('events', query);
    const events = (Array.isArray(b.events) ? b.events : []).map(decodeEvent).filter((e): e is AppEvent => e !== null);
    return { events, lastSeq: typeof b.lastSeq === 'number' ? b.lastSeq : 0, oldestSeq: typeof b.oldestSeq === 'number' ? b.oldestSeq : 0 };
  }

  async sendMessage(m: { text?: string; choice?: string; channel?: string; clientId?: string }): Promise<{ seq: number; duplicate?: boolean }> {
    const body: Record<string, unknown> = {};
    if (m.text !== undefined) body.text = m.text;
    if (m.choice !== undefined) body.choice = m.choice;
    if (m.channel) body.channel = m.channel;
    if (m.clientId) body.clientId = m.clientId;
    const b = await this.post('messages', body);
    return { seq: Number(b.seq ?? 0), duplicate: b.duplicate === true };
  }

  async answerCard(cardId: string, answer: CardAnswer, remember = false, option?: CardOption): Promise<CardResult> {
    const b = await this.post(cardPath(cardId), cardBody(answer, remember, option));
    return { state: typeof b.state === 'string' ? b.state : 'approved', reply: b.reply as string | undefined, answer: b.answer as string | undefined };
  }

  /** `GET views/<name>` → `data`. */
  async view<T>(name: string, query?: Record<string, string>): Promise<T> {
    const b = await this.get(`views/${name}`, query);
    if (!('data' in b)) throw new ApiError('decoding');
    return b.data as T;
  }

  async viewAction<T = unknown>(name: string, action: string, body: Record<string, unknown>): Promise<T> {
    const b = await this.post(`views/${name}/${action}`, body);
    return b.data as T;
  }

  /** §7.4 reactions: 👍 = more like this, 👎 = less. */
  async react(seq: number, emoji: '👍' | '👎') { await this.post(`messages/${seq}/react`, { emoji }); }
  /** §21.4: the owner read a room (other devices clear it too). */
  async markRead(channel: string, upTo: number) { await this.post('read', { channel, upTo }); }

  /** R7: the key goes straight to the Mac's Keychain and is never sent back. */
  async connectProvider(id: string, apiKey: string) { await this.post(`providers/${encodeURIComponent(id)}/key`, { apiKey }); }
  async disconnectProvider(id: string) { await this.post(`providers/${encodeURIComponent(id)}/disconnect`, {}); }

  /** `room`: a team or bot room's channel (header `x-channel`, feature `share-rooms`); none = the main chat. */
  async share(bytes: Uint8Array, name: string, contentType: string, room?: string) {
    let reply: RawReply;
    const headers: Record<string, string> = { 'content-type': contentType || 'application/octet-stream', 'x-file-name': encodeURIComponent(name) };
    if (room) headers['x-channel'] = room;
    try { reply = await this.transport.upload('share', bytes, headers); }
    catch (e) { throw toApiError(e); }
    return this.check(reply);
  }

  /** §30: a short recording → words for the message box (`{text, message?}`). */
  async dictate(bytes: Uint8Array, contentType: string): Promise<unknown> {
    let reply: RawReply;
    try { reply = await this.transport.upload('dictation', bytes, { 'content-type': contentType || 'audio/mp4' }); }
    catch (e) { throw toApiError(e); }
    return this.check(reply);
  }

  /** R14: one recording piece. `received` = pieces the Mac has with no gaps from 0. */
  async uploadChunk(id: string, index: number, total: number, bytes: Uint8Array, startedAt: string, durationSec: number, contentType = 'audio/mp4') {
    let reply: RawReply;
    try {
      reply = await this.transport.upload(`recordings/${id}/chunks/${index}`, bytes, {
        'content-type': contentType, 'x-chunk-total': String(total), 'x-started-at': startedAt, 'x-duration-sec': String(Math.round(durationSec)),
      });
    } catch (e) { throw toApiError(e); }
    const b = this.check(reply);
    return { received: Number(b.received ?? 0), complete: b.complete === true };
  }
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('offline');
}

export const hasFeature = (c: Capabilities, f: string) => c.features.includes(f);
export const hasView = (c: Capabilities, v: string) => c.views.some((x) => x.name === v);
/** Sharing a file into a team or bot room (`x-channel`), not only the main chat. */
export const canShareIn = (c: Capabilities, room: string) => hasFeature(c, 'share') && (!room || hasFeature(c, 'share-rooms'));
export const viewActions = (c: Capabilities, v: string) => c.views.find((x) => x.name === v)?.actions ?? [];
