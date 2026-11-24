import { isPayment, type CardClosedEvent, type CardEvent, type CardOption } from './events';

/** How a card is answered (§4, §7.3, §8 R3). */
export type CardAnswer = { decision: 'approve' | 'deny' | 'edit' } | { option: string } | { text: string };

/** Plain Korean for a finished card. */
export function closedLabel(closure: CardClosedEvent | undefined, expired: boolean): string {
  if (closure?.answer) return `답함: ${closure.answer}`;
  switch (closure?.state) {
    case 'approved': return '승인했어요';
    case 'denied': return '안 하기로 했어요';
    case 'edit': return '고쳐 달라고 했어요';
    case 'closed': return '다른 곳에서 처리했어요';
    case 'expired': return '시간이 지나 닫혔어요';
    default: return expired ? '시간이 지나 닫혔어요' : '끝났어요';
  }
}

/** Buttons when the server sends none (older ax-kit cards): the three classic decisions in easy words. */
export function defaultOptions(card: CardEvent): CardOption[] {
  const yes = isPayment(card) ? '네, 결제해요' : card.effects.includes('send') ? '네, 보내요' : card.effects.includes('delete') ? '네, 지워요' : '네, 해 주세요';
  return [
    { id: 'decision:approve', label: yes, tone: 'primary' },
    { id: 'decision:edit', label: '고쳐서 다시', tone: 'neutral' },
    { id: 'decision:deny', label: '아니요', tone: 'danger' },
  ];
}

export const optionsFor = (card: CardEvent) => (card.options?.length ? card.options : defaultOptions(card));

/** A button id from `defaultOptions` back into a protocol answer. */
export function answerFor(option: CardOption): CardAnswer {
  if (option.id.startsWith('decision:')) return { decision: option.id.slice('decision:'.length) as 'approve' | 'deny' | 'edit' };
  return { option: option.id };
}

/** A choice that only opens a screen in the app and sends nothing (§24: the team-structure card's "앱에서 고칠게요"). */
export function opensInApp(card: CardEvent, option: CardOption): 'team-plan' | null {
  return card.topic?.startsWith('bots:team-plan') && option.id === 'fix-in-app' ? 'team-plan' : null;
}

/** The `POST cards/<id>` body. `remember` only goes with a chosen option that is not a "no" (R11). */
export function cardBody(answer: CardAnswer, remember: boolean, option?: CardOption): Record<string, unknown> {
  const body: Record<string, unknown> = { ...answer };
  if (remember && 'option' in answer && option?.tone !== 'danger') body.remember = true;
  if (remember && 'decision' in answer && answer.decision === 'approve') body.remember = true;
  return body;
}

/** Card ids are `[A-Za-z0-9_:.-]{1,200}`; URL-encode them for the path. */
export const cardPath = (cardId: string) => `cards/${encodeURIComponent(cardId)}`;
