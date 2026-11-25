// Buttons in the chat read like a conversation: the assistant asks in one bubble with its buttons inside, the owner's
// pick shows as their own line, and buttons that can no longer be used are dimmed (not hidden).
import type { CardClosedEvent, CardEvent, CardOption } from './events';
import type { Item } from './timeline';
import { optionsFor } from './cards';

/** A main-room notice that asks something (has buttons) or says more than a line is the assistant talking. */
export const noticeIsBubble = (n: { text: string; choices?: unknown[] }) =>
  !!n.choices?.length || n.text.trim().split('\n').filter((l) => l.trim()).length > 1;

/**
 * The seq of the one line in a room whose buttons still work: the latest line with buttons, unless the owner has
 * said or picked something after it (then the conversation moved on). Every other line's buttons are dimmed.
 */
export function liveChoicesSeq(items: readonly Item[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'message' && it.event.role === 'owner') return null;
    if ((it.kind === 'message' || it.kind === 'notice') && it.event.choices?.length) return it.seq;
  }
  return null;
}

/** What the owner "said" by answering a card in the chat (their line after the question), or null when it closed elsewhere. */
export function cardEcho(card: CardEvent, closure: CardClosedEvent | undefined): string | null {
  if (!closure) return null;
  if (closure.answer?.trim()) return closure.answer.trim();
  const options = optionsFor(card);
  const pick = (id: string, tone: CardOption['tone']) => options.find((o) => o.id === id) ?? options.find((o) => o.tone === tone);
  switch (closure.state) {
    case 'approved': return pick('decision:approve', 'primary')?.label ?? '네, 해 주세요';
    case 'denied': return pick('decision:deny', 'danger')?.label ?? '아니요';
    case 'edit': return options.find((o) => o.id === 'decision:edit')?.label ?? '고쳐서 다시';
    default: return null;
  }
}

/** The option a closed card was answered with (to mark it among the dimmed buttons). */
export function answeredOption(card: CardEvent, closure: CardClosedEvent | undefined): string | null {
  const echo = cardEcho(card, closure);
  return echo ? optionsFor(card).find((o) => o.label === echo)?.id ?? null : null;
}
