import { parseBotTalk } from './chatText';
import type { AppEvent } from './events';

// Which live events become a Mac notification (when the window is not in front). Same spirit as the phone push
// rules (APP-PROTOCOL §7.7): 결재 always; the assistant's messages and notices; a team finishing or getting stuck.
// Bot-to-bot talk inside team and meeting rooms stays quiet. Old events replayed after a reconnect never notify.

export interface Note { title: string; body: string; key: string }

export function noteFor(event: AppEvent, ctx: { assistantName: string; roomTitle: (room: string) => string; now?: number }): Note | null {
  const now = ctx.now ?? Date.now();
  const at = Date.parse(event.at);
  if (Number.isFinite(at) && now - at > 10 * 60_000) return null;
  const room = event.channel ?? '';
  // §21.3 work threads (a bot's step-by-step log under a task) and bot-to-bot talk stay quiet; the result comes on its own.
  if ((event.type === 'message' || event.type === 'notice') && (event.thread || parseBotTalk(event.text))) return null;
  switch (event.type) {
    case 'card':
      return { title: `결재: ${event.summary}`, body: event.note ?? (event.author?.name ? `${event.author.name}이(가) 물어봐요` : ''), key: `card:${event.cardId}` };
    case 'message':
      if (event.role !== 'assistant') return null;
      if (room && event.to) return null; // bots talking to each other
      if (room && room.startsWith('meeting:')) return null;
      return { title: room ? `${event.author?.name ?? ctx.roomTitle(room)}` : ctx.assistantName, body: event.text, key: `msg:${event.seq}` };
    case 'notice':
      return room ? null : { title: ctx.assistantName, body: event.text, key: `notice:${event.seq}` };
    case 'delegation':
      if (event.state === 'started') return null;
      return { title: event.state === 'done' ? `${event.bot.name}: 끝냈어요` : `${event.bot.name}: 막혔어요`, body: event.summary ?? event.task, key: `del:${event.seq}` };
    default:
      return null;
  }
}

/** At most `max` notifications per `windowMs`; the rest fold into one "새 소식 N개" line. */
export class NoteLimiter {
  private sent: number[] = [];
  private held = 0;
  constructor(private readonly max = 3, private readonly windowMs = 60_000) {}

  /** Returns the notes to show now (the note itself, or nothing while over the limit). */
  offer(note: Note, now = Date.now()): Note[] {
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    if (this.sent.length < this.max) {
      this.sent.push(now);
      const out: Note[] = [];
      if (this.held) { out.push({ title: 'ax-kit', body: `새 소식이 ${this.held}개 더 있어요`, key: `held:${now}` }); this.held = 0; }
      out.push(note);
      return out;
    }
    this.held++;
    return [];
  }

  /** Called when the window comes to the front: nothing waiting matters any more. */
  reset() { this.held = 0; }
}
