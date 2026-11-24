import { clock, monthDay } from './format';

// Cleans what the Mac sends before it is shown, so leftovers from Discord, logs and prompts never reach the screen
// even when the server has not caught up: mentions, emoji codes, internal ids, `key: value` metadata, prompt blocks.
// Same rules as the iPhone app (AxKitCore/ChatText.swift).

const SHORTCODES: Record<string, string> = {
  white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', warning: '⚠️', rotating_light: '🚨', tada: '🎉', eyes: '👀', memo: '📝',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', fire: '🔥', bulb: '💡', hammer_and_wrench: '🛠️', tools: '🛠️', gear: '⚙️',
  lock: '🔒', bell: '🔔', calendar: '📅', pushpin: '📌', red_circle: '🔴', green_circle: '🟢', yellow_circle: '🟡', orange_circle: '🟠',
  large_blue_circle: '🔵', information_source: 'ℹ️', no_entry: '⛔', stop_sign: '🛑', rocket: '🚀', speech_balloon: '💬', art: '🎨',
  test_tube: '🧪', shield: '🛡️', money_with_wings: '💸', moneybag: '💰', clipboard: '📋', mag: '🔍', hourglass: '⌛', zzz: '💤',
  wave: '👋', pray: '🙏', sparkles: '✨', star: '⭐', heart: '❤️',
};

const META = /^[a-zA-Z][a-zA-Z0-9_]{1,24}: \S/;
export const isMetadataLine = (line: string) => META.test(line);

function dropPromptBlocks(text: string): string {
  let t = text.replace(/<([a-z][a-z0-9_]*)>[\s\S]*?<\/\1>/g, '');
  t = t.replace(/\n?<[a-z][a-z0-9_]*_[a-z0-9_]*>[\s\S]*$/, '');
  const m = /^.*params_json.*$/m.exec(t);
  if (m) t = t.slice(0, m.index);
  return t;
}

function cutMetadata(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) if (isMetadataLine(lines[i]) && isMetadataLine(lines[i + 1])) return lines.slice(0, i).join('\n');
  if (lines.length > 1 && isMetadataLine(lines[lines.length - 1])) return lines.slice(0, -1).join('\n');
  return text;
}

function discord(text: string): string {
  let t = text;
  t = t.replace(/<@[!&]?\d+>\s?/g, '');
  t = t.replace(/<#\d+>/g, '');
  t = t.replace(/<a?:\w+:\d+>/g, '');
  t = t.replace(/<t:(\d{9,11})(?::[a-zA-Z])?>/g, (_, s: string) => { const d = new Date(Number(s) * 1000); return `${monthDay(d)} ${clock(d)}`; });
  t = t.replace(/(?<![\w:/]):([a-z0-9_+-]{2,30}):(?![\w/])/g, (_, code: string) => SHORTCODES[code] ?? '');
  t = t.replace(/\|\|(.+?)\|\|/g, '$1');
  t = t.replace(/^-# /gm, '');
  t = t.replaceAll('#결재', '결재 탭');
  t = t.replace(/(?<![\w#&])#([가-힣]{1,8}?)(?=(?:에서|으로|에|을|를|이|가|은|는|의|로)?(?:[\s,.)!?]|$))/g, '$1 방').replaceAll('방 방', '방');
  return t;
}

function plainLines(text: string): string {
  const out: string[] = [];
  for (let line of text.split('\n')) {
    if (line.trim().startsWith('```')) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) {
      const body = m[1].trim();
      line = body ? (body.startsWith('**') ? body : `**${body}**`) : '';
    } else if ((m = /^\s{0,3}>\s?(.*)$/.exec(line))) {
      line = m[1];
    } else if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function dropInternalIds(text: string): string {
  return text
    .replace(/\s*\((?:head|commit|작업|run|id)\s+[0-9a-f]{6,40}\)/g, '')
    .replace(/\s*·\s*[A-Za-z0-9][A-Za-z0-9._/:-]*[0-9a-f]{8,}[A-Za-z0-9._/:-]*(?=\s*(·|\n|$))/g, '')
    .replace(/\s*·\s*[a-z0-9-]+\/[A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}(?=\s*(·|\n|$))/g, '');
}

function glossary(text: string): string {
  let t = text.replace(/([\u2600-\u27BF\u{1F300}-\u{1FAFF}]\uFE0F?)(\s*\1)+/gu, '$1');
  for (const [en, ko] of [['Engineer', '개발 봇'], ['P0 결정', '긴급 결정']]) t = t.replace(new RegExp(`(?<![A-Za-z])${en}(?![A-Za-z])`, 'g'), ko);
  return t;
}

/** Text for a chat bubble or a list line (keeps inline markdown, turns block markdown into plain lines). */
export function cleanText(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n');
  t = dropPromptBlocks(t);
  t = cutMetadata(t);
  t = discord(t);
  t = plainLines(t);
  t = dropInternalIds(t);
  t = glossary(t);
  // Addresses read as written ("…/__없는-주소"), not as %EC%97….
  t = t.replace(/https?:\/\/[^\s\]\)]+/g, (u) => { try { return u.includes('%') ? decodeURI(u) : u; } catch { return u; } });
  t = t.replace(/(?<=\S)[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
  return t.trim();
}

/** One line for a list: cleaned, markdown marks removed, newlines folded. */
export function previewText(raw: string, limit = 120): string {
  let t = cleanText(raw)
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[•-]\s+/, '')
    .replace(/\s*\n+\s*[•-]?\s*/g, ' · ')
    .trim();
  if ([...t].length > limit) t = [...t].slice(0, limit - 1).join('') + '…';
  return t;
}

/** A card summary that is only metadata ("eventId: 8648") is useless as a title: use the note's first sentence. */
export function cardTitle(summary: string, note?: string): string {
  const s = cleanText(summary);
  if (s && !isMetadataLine(s)) return s;
  const first = cleanText(note ?? '').split('\n')[0] ?? '';
  return first || '확인이 필요한 일';
}

/** A 결재 in the chat: the question, then why (cleaned, never raw context). */
export function cardLine(summary: string, note?: string): string {
  const title = cardTitle(summary, note);
  const n = cleanText(note ?? '');
  if (!n || n.startsWith(title)) return n || title;
  return `${title}\n${n}`;
}

export interface BotTalk { from: string; to: string; label?: string; text: string; isReply: boolean }

/** "💬 Leo → Mia · 검토 요청: …" / "↩️ Mia → Leo · 답 (승인): …". */
export function parseBotTalk(raw: string): BotTalk | null {
  const m = /^\s*(💬|↩️|↩︎|↪️)?\s*([^\s→·:]{1,20}(?: [^\s→·:]{1,20})?)\s*(?:→|->)\s*([^\s→·:]{1,20}(?: [^\s→·:]{1,20})?)\s*·\s*([^:\n]{1,24}):\s*([\s\S]+)$/u.exec(raw);
  if (!m) return null;
  const label = m[4].trim();
  return { from: m[2], to: m[3], label: label || undefined, text: m[5].trim(), isReply: (m[1] ?? '').startsWith('↩') || label.startsWith('답') };
}
