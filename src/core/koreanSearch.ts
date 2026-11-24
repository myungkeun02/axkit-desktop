// Finding documents the way people type in Korean: spaces, case and marks like / · - ignored, part of a word is
// enough, and a query of initial consonants only ("ㄱㅈ") matches by first sounds ("결제"). Same as the iPhone app.

const INITIALS = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const isKept = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
const isSyllable = (ch: string) => { const c = ch.codePointAt(0)!; return c >= 0xac00 && c <= 0xd7a3; };
const initialOf = (ch: string) => INITIALS[Math.floor((ch.codePointAt(0)! - 0xac00) / 588)];

export const normalize = (text: string) => [...text.toLowerCase()].filter(isKept).join('');
export const initialSounds = (text: string) => [...normalize(text)].map((ch) => (isSyllable(ch) ? initialOf(ch) : ch)).join('');
export const isInitialsOnly = (q: string) => { const n = normalize(q); return !!n && [...n].every((c) => INITIALS.includes(c)); };

export function matches(text: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return isInitialsOnly(q) ? initialSounds(text).includes(q) : normalize(text).includes(q);
}

/** [start, end) of the hit in the original text (spaces inside the hit allowed), for highlighting. */
export function findRange(text: string, query: string): [number, number] | null {
  const q = [...normalize(query)];
  if (!q.length) return null;
  const initials = isInitialsOnly(query);
  const kept: { ch: string; at: number; end: number }[] = [];
  let at = 0;
  for (const ch of text) {
    if (isKept(ch)) kept.push({ ch: initials && isSyllable(ch) ? initialOf(ch) : ch.toLowerCase(), at, end: at + ch.length });
    at += ch.length;
  }
  for (let s = 0; s + q.length <= kept.length; s++) {
    if (q.every((c, i) => kept[s + i].ch === c)) return [kept[s].at, kept[s + q.length - 1].end];
  }
  return null;
}

/** The line of a document that holds the query, trimmed around the hit. */
export function snippet(body: string, query: string, width = 70): string | null {
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/^[#>*\-•\s]+/, '').replaceAll('**', '');
    const r = findRange(line, query);
    if (!r) continue;
    if (line.length <= width || r[0] < width / 3) return line.length > width ? line.slice(0, width) + '…' : line;
    const tail = line.slice(r[0] - Math.floor(width / 3));
    return '…' + (tail.length > width ? tail.slice(0, width) + '…' : tail);
  }
  return null;
}
