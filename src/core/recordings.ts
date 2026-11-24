// R14: a finished recording goes to the Mac in pieces of at most 4MB (upload limit 12MB, 1..64 pieces), resuming
// from the first piece the Mac does not have yet.

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_CHUNKS = 64;

export interface PendingRecording {
  id: string;
  startedAt: string;
  durationSec: number;
  /** `audio/mp4` (AAC) when WebKit can, else `audio/webm`. */
  contentType?: string;
  bytes: Uint8Array;
  /** Pieces the Mac has, with no gaps from 0. */
  received: number;
}

export const chunkCount = (size: number) => Math.max(1, Math.ceil(size / CHUNK_BYTES));

/** `r_` + lowercase letters, digits and dashes (the server's `r_[a-z0-9-]{1,40}`). */
export function recordingId(now = Date.now(), rand = Math.random()) {
  return `r_${now.toString(36)}-${Math.floor(rand * 1e8).toString(36)}`;
}

export type ChunkUpload = (index: number, total: number, piece: Uint8Array) => Promise<{ received: number; complete: boolean }>;

/** Sends what is missing. Returns true when the Mac has it all. Throws on a network error (try again later). */
export async function sendRecording(rec: PendingRecording, upload: ChunkUpload, onProgress?: (received: number, total: number) => void): Promise<boolean> {
  const total = chunkCount(rec.bytes.length);
  if (total > MAX_CHUNKS) throw new Error('녹음이 너무 길어요.');
  let index = rec.received;
  for (let guard = 0; index < total && guard < total * 3; guard++) {
    const piece = rec.bytes.subarray(index * CHUNK_BYTES, Math.min((index + 1) * CHUNK_BYTES, rec.bytes.length));
    const result = await upload(index, total, piece);
    if (result.complete) { rec.received = total; onProgress?.(total, total); return true; }
    // The Mac says where to go on (it may have lost a piece); never go backwards past 0 or forwards past total.
    rec.received = Math.min(Math.max(result.received, 0), total);
    index = rec.received;
    onProgress?.(rec.received, total);
  }
  return rec.received >= total;
}
