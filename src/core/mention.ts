// '@' in the message box: pick a bot by name (views/bots). The Mac reads '@이름' in the message and hands that bot
// a written-up instruction (§31).

export interface MentionTarget { name: string; detail?: string }

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** The '@…' being typed right before the caret: '@' at the start or after a space, then up to 20 characters with no
 *  line break. Returns where it starts and what was typed after '@'. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null; // an email address, not a mention
  const query = before.slice(at + 1);
  if (query.length > 20 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

/** Names that start with (then contain) what was typed, spaces ignored; at most `max`, one per name. */
export function mentionMatches(targets: MentionTarget[], query: string, max = 6): MentionTarget[] {
  const q = squash(query);
  // '@개발 봇 ' — a whole name and a space: already picked, nothing to offer.
  if (/\s$/.test(query) && targets.some((t) => squash(t.name) === q)) return [];
  const seen = new Set<string>();
  const unique = targets.filter((t) => t.name.trim() && !seen.has(t.name) && seen.add(t.name));
  const starts = unique.filter((t) => squash(t.name).startsWith(q));
  const contains = q ? unique.filter((t) => !squash(t.name).startsWith(q) && squash(t.name).includes(q)) : [];
  return [...starts, ...contains].slice(0, max);
}

/** Replaces '@…' with '@이름 ' and puts the caret after the space. */
export function insertMention(text: string, start: number, caret: number, name: string): { value: string; caret: number } {
  const inserted = `@${name} `;
  const after = text.slice(caret).replace(/^ /, '');
  return { value: text.slice(0, start) + inserted + after, caret: start + inserted.length };
}
