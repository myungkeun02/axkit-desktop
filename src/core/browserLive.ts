// §22 browser-live: the owner takes over a page the assistant's browser errand stopped on (login, captcha, consent,
// the last button). Pure helpers for the screen; the picture stream and actions go through the platform.

export interface LiveState {
  live: boolean;
  url?: string; title?: string;
  reason?: 'login' | 'payment' | 'consent' | 'captcha' | 'other' | string;
  startedAt?: string; idleClosesAt?: string;
  pending?: { url: string; reason?: string; at?: string };
  closed?: 'done' | 'idle' | 'stopped' | 'error' | 'shutdown' | string;
}
export interface LiveFrame { seq: number; url?: string; title?: string; width: number; height: number; jpeg: string }

export const LIVE_KEYS = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

/** The assistant hands a page over ("앱의 브라우저 화면에서 직접 …"); the chat shows an "open" button under it —
 * but not under the owner's own "(… 직접 마쳤어요 …)" line after `done`. Same rule as the iPhone app. */
export const mentionsHandover = (text: string) => text.includes('앱의 브라우저 화면') && !text.includes('직접 마쳤어요');

/** The '브라우저 화면 열기' button: the `live` field first; finding the sentence is only for older servers that send no field. */
export function handsOver(m: { role?: string; text: string; live?: { view: string } }): boolean {
  if (m.live) return m.live.view === 'browser-live';
  return mentionsHandover(m.text);
}

/** Where to go after `done`: the room the errand came from, the main chat, or (Discord) stay put with a note. */
export function afterDone(r: { resumed?: boolean; continuedIn?: string; channel?: string }): { room: string; say: string } {
  if (!r.resumed) return { room: '', say: '브라우저 화면을 닫았어요.' };
  if (r.continuedIn === 'elsewhere') return { room: '', say: '브라우저 화면에서 마친 일은 디스코드 대화에서 이어 갈게요.' };
  return { room: r.channel ?? '', say: '다 했다고 전했어요. 비서가 이어서 해요.' };
}

/** "shop.example.com" from the page address. */
export function hostOf(url?: string): string {
  if (!url) return '';
  try { return new URL(url).host; } catch { return url; }
}

/** Desktop keys sent straight to the page while the picture has focus (letters go through '글자 쓰기'). */
export function liveKeyFor(key: string): (typeof LIVE_KEYS)[number] | null {
  return (LIVE_KEYS as readonly string[]).includes(key) ? (key as (typeof LIVE_KEYS)[number]) : null;
}

/** 알아 둔 사이트 rows are {title: name, detail: "host · what"}: what to say to forget one (the Mac has no action for it). */
export function forgetSiteMessage(row: { title: string; detail?: string }): string {
  // Like the iOS app: the detail's first part when it looks like a host ("tank.betalab.kr · 근태"), otherwise the title.
  const first = (row.detail ?? '').split(' · ')[0].trim();
  const host = first.includes('.') ? first : row.title;
  return `${host} 사이트(${row.title})는 이제 잊어 줘`;
}

export function reasonLabel(reason?: string): string {
  switch (reason) {
    case 'login': return '로그인이 필요해요';
    case 'payment': return '마지막 결제 버튼은 직접 눌러 주세요';
    case 'consent': return '약관 동의가 필요해요';
    case 'captcha': return '사람인지 확인하는 단계예요';
    default: return '직접 해 주셔야 하는 단계예요';
  }
}

export function closedLabel(closed?: string): string | null {
  switch (closed) {
    case 'done': return '다 했다고 전했어요. 비서가 이어서 해요.';
    case 'idle': return '15분 동안 아무것도 하지 않아 화면을 닫았어요.';
    case 'stopped': return '전체 정지로 화면을 닫았어요.';
    case 'shutdown': return '맥의 비서가 멈춰서 화면이 닫혔어요.';
    case 'error': return '브라우저에 문제가 생겨 화면이 닫혔어요.';
    default: return null;
  }
}

/** A click on the shown picture → the JPEG pixel the server expects (rounded, kept inside the picture). */
export function toJpegPoint(x: number, y: number, shownW: number, shownH: number, jpegW: number, jpegH: number): { x: number; y: number } {
  const px = Math.round((x / Math.max(shownW, 1)) * jpegW);
  const py = Math.round((y / Math.max(shownH, 1)) * jpegH);
  return { x: Math.min(Math.max(px, 0), jpegW - 1), y: Math.min(Math.max(py, 0), jpegH - 1) };
}

/** Wheel movement on the shown picture → JPEG pixels, clamped to the server's ±4000. */
export function toJpegScroll(dy: number, shownH: number, jpegH: number): number {
  return Math.max(-4000, Math.min(4000, Math.round((dy / Math.max(shownH, 1)) * jpegH)));
}
