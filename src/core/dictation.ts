// §30 받아쓰기: the owner speaks, the Mac turns it into words, and the words go into the message box where the
// owner fixes them and sends. Nothing is sent on its own.

/** Recording stops by itself after 3 minutes (longer talks belong in 회의 녹음). */
export const DICTATION_MAX_SEC = 180;
/** Under this a recording is just a click. */
export const DICTATION_MIN_SEC = 1;

export const MIC_DENIED = '마이크를 쓸 수 없어요. 시스템 설정 › 개인정보 보호 › 마이크에서 ax-kit를 켜 주세요.';
export const MIC_SILENT = '마이크 소리가 들어오지 않아요. 시스템 설정 › 사운드 › 입력에서 마이크를 고르고 입력 음량을 올려 주세요.';
/** Below this the whole recording is silence (the Mac would hear nothing): don't send it. */
export const SILENT_DB = -55;

/** RMS of samples centred on 128 (AnalyserNode byte time-domain data) → dBFS. */
export function rmsDb(samples: ArrayLike<number>): number {
  if (!samples.length) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** dBFS → 0..1 for the little meter (-60 dB and below is empty). */
export const meterOf = (db: number) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0);

export const NOTHING_HEARD = '말소리를 찾지 못했어요. 조금 더 크게 말해 주세요.';

/** Puts `text` where the caret is (replacing a selection), with a space between it and a neighbouring word.
 *  Returns the new value and where the caret goes (right after the inserted words). */
export function insertDictation(value: string, start: number | null, end: number | null, text: string): { value: string; caret: number } {
  const words = text.trim();
  const s = Math.max(0, Math.min(start ?? value.length, value.length));
  const e = Math.max(s, Math.min(end ?? s, value.length));
  if (!words) return { value, caret: e };
  const before = value.slice(0, s);
  const after = value.slice(e);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const inserted = lead + words + trail;
  return { value: before + inserted + after, caret: before.length + lead.length + words.length };
}

/** 0:07, 1:42 */
export function clockLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The Mac's answer: `{text}`, with `message` when it heard nothing. */
export function decodeDictation(body: unknown): { text: string; message?: string } {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim().slice(0, 300) : undefined;
  return { text, message };
}
