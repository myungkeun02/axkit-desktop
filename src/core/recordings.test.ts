import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, chunkCount, recordingId, sendRecording, type PendingRecording } from './recordings';

const rec = (size: number): PendingRecording => ({ id: 'r_x', startedAt: '', durationSec: 60, bytes: new Uint8Array(size), received: 0 });

describe('recordings', () => {
  it('splits into 4MB pieces', () => {
    expect(chunkCount(10)).toBe(1);
    expect(chunkCount(CHUNK_BYTES)).toBe(1);
    expect(chunkCount(CHUNK_BYTES * 2 + 1)).toBe(3);
  });

  it('makes ids the server accepts', () => {
    expect(recordingId()).toMatch(/^r_[a-z0-9-]{1,40}$/);
  });

  it('sends every piece in order and resumes after a failure', async () => {
    const r = rec(CHUNK_BYTES * 2 + 5);
    const have = new Set<number>();
    let fail = true;
    const upload = async (i: number, total: number, piece: Uint8Array) => {
      if (i === 1 && fail) { fail = false; throw new Error('offline'); }
      expect(piece.length).toBe(i === 2 ? 5 : CHUNK_BYTES);
      have.add(i);
      let received = 0;
      while (have.has(received)) received++;
      return { received, complete: received >= total };
    };
    await expect(sendRecording(r, upload)).rejects.toThrow('offline');
    expect(r.received).toBe(1);
    expect(await sendRecording(r, upload)).toBe(true);
    expect([...have].sort()).toEqual([0, 1, 2]);
  });

  it('goes back when the Mac lost a piece', async () => {
    const r = rec(CHUNK_BYTES * 2);
    const calls: number[] = [];
    let lost = true;
    const done = await sendRecording(r, async (i, total) => {
      calls.push(i);
      if (i === 1 && lost) { lost = false; return { received: 0, complete: false }; }
      return { received: i + 1, complete: i + 1 >= total };
    });
    expect(done).toBe(true);
    expect(calls).toEqual([0, 1, 0, 1]);
  });
});
