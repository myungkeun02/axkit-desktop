import { describe, expect, it } from 'vitest';
import { ANDROID_APK, qrMatrix, qrPath } from './qr';

describe('qr (local)', () => {
  it('draws a square code with the three finder squares', () => {
    const m = qrMatrix(ANDROID_APK);
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect((n - 17) % 4).toBe(0);
    expect(m.every((row) => row.length === n)).toBe(true);
    // finder: dark 7x7 border, light ring, dark 3x3 middle — top-left, top-right, bottom-left
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[r0][c0] && m[r0 + 6][c0 + 6] && m[r0 + 3][c0 + 3]).toBe(true);
      expect(m[r0 + 1][c0 + 1]).toBe(false);
    }
  });
  it('is the same for the same text and differs for another', () => {
    expect(qrMatrix('abc')).toEqual(qrMatrix('abc'));
    expect(qrMatrix('abc')).not.toEqual(qrMatrix('abd'));
  });
  it('makes one path with a quiet zone', () => {
    const { d, size } = qrPath([[true, false], [false, true]], 4);
    expect(size).toBe(10);
    expect(d).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
  });
});
