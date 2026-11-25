import { describe, expect, it } from 'vitest';
import { canShareIn } from './api';

describe('sharing files into rooms (x-channel)', () => {
  const caps = (features: string[]) => ({ features, views: [] });
  it('always in the main chat, in a room only when the Mac files it there', () => {
    expect(canShareIn(caps(['share']), '')).toBe(true);
    expect(canShareIn(caps(['share']), 'team-dev')).toBe(false);
    expect(canShareIn(caps(['share', 'share-rooms']), 'team-dev')).toBe(true);
    expect(canShareIn(caps([]), '')).toBe(false);
  });
});
