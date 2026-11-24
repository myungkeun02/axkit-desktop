// Messages written while the Mac is away wait here and go out in order when it is back. Each has a `clientId`
// so a resend after a lost reply is never doubled (§3 `POST messages`). A message the Mac refuses is never thrown
// away: it stays as "보내지 못했어요" with 다시 보내기 / 지우기. Each server keeps its own list (`scope`), so words
// meant for one Mac never go to another.

export interface Pending {
  id: string;
  text: string;
  channel: string;
  createdAt: number;
  /** Set when the Mac refused it (the owner decides: send again or delete). */
  failed?: string;
}

export interface OutboxStorage { load(scope: string): Pending[]; save(scope: string, list: Pending[]): void }

export const memoryStorage = (): OutboxStorage => {
  const lists = new Map<string, Pending[]>();
  return { load: (s) => lists.get(s) ?? [], save: (s, l) => { lists.set(s, l); } };
};

export interface FlushResult { sent: Pending[]; failed: Pending[]; waiting: boolean }

/** What to do with an error: wait and try again later, or mark the message as refused (with words for the owner). */
export type Verdict = { wait: true } | { wait: false; reason: string };

export class Outbox {
  private list: Pending[];
  private flushing = false;
  private scope: string;
  constructor(private readonly storage: OutboxStorage, scope = 'local', private readonly newId: () => string = () => crypto.randomUUID()) {
    this.scope = scope;
    this.list = this.read();
  }

  private read() { return this.storage.load(this.scope).filter((p) => p && typeof p.text === 'string'); }
  private save() { this.storage.save(this.scope, this.list); }

  /** Another server: its own list. */
  useScope(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope;
    this.list = this.read();
  }

  get pending(): readonly Pending[] { return this.list; }
  /** Still to send (not refused). */
  get waiting(): readonly Pending[] { return this.list.filter((p) => !p.failed); }

  enqueue(text: string, channel: string, now = Date.now()): Pending {
    const p = { id: this.newId(), text: text.slice(0, 8000), channel, createdAt: now };
    this.list = [...this.list, p];
    this.save();
    return p;
  }

  /** 다시 보내기: back in the queue with the same clientId (the Mac drops a double). */
  retry(id: string) {
    this.list = this.list.map((p) => (p.id === id ? { id: p.id, text: p.text, channel: p.channel, createdAt: p.createdAt } : p));
    this.save();
  }

  remove(id: string) {
    this.list = this.list.filter((p) => p.id !== id);
    this.save();
  }

  /** Sends in order; stops at the first error worth waiting on. A refused one stays, marked, and the rest go on. */
  async flush(send: (p: Pending) => Promise<void>, verdict: (e: unknown) => Verdict): Promise<FlushResult> {
    const result: FlushResult = { sent: [], failed: [], waiting: false };
    if (this.flushing) return result;
    this.flushing = true;
    try {
      for (;;) {
        const p = this.list.find((x) => !x.failed);
        if (!p) break;
        try {
          await send(p);
          result.sent.push(p);
          this.list = this.list.filter((x) => x.id !== p.id);
        } catch (e) {
          const v = verdict(e);
          if (v.wait) { result.waiting = true; break; }
          const marked = { ...p, failed: v.reason };
          result.failed.push(marked);
          this.list = this.list.map((x) => (x.id === p.id ? marked : x));
        }
        this.save();
      }
    } finally {
      this.flushing = false;
    }
    return result;
  }

  clear() { this.list = []; this.save(); }
}
