import { describe, expect, it } from 'vitest';
import { decodeDesktopBuild, decodeReleaseBuild, newerBuild, pickUpdate } from './appUpdate';

const sha = 'AB'.repeat(32);

describe('app updates (§32)', () => {
  it('reads the desktop build and skips broken ones', () => {
    expect(decodeDesktopBuild({ desktop: { build: 210, versionName: '0.1.210', sha256: sha, size: 4089061, builtAt: '2026-11-24T06:00:00Z' } }))
      .toEqual({ build: 210, versionName: '0.1.210', sha256: sha.toLowerCase(), size: 4089061, builtAt: '2026-11-24T06:00:00Z' });
    expect(decodeDesktopBuild({ android: { build: 3 } })).toBeNull();
    expect(decodeDesktopBuild({ desktop: { build: 210, sha256: 'nope', size: 1 } })).toBeNull();
    expect(decodeDesktopBuild({ desktop: { build: 0, sha256: sha, size: 1 } })).toBeNull();
    expect(decodeDesktopBuild(null)).toBeNull();
  });
  it('offers only a bigger build, never to a build without a number', () => {
    const b = decodeDesktopBuild({ desktop: { build: 210, sha256: sha, size: 10 } });
    expect(newerBuild(b, 209)).toBe(b);
    expect(newerBuild(b, 210)).toBeNull();
    expect(newerBuild(b, 0)).toBeNull();
    expect(newerBuild(null, 5)).toBeNull();
  });
  it('reads the public release json', () => {
    const r = decodeReleaseBuild({ build: 41, versionName: '0.1.41', builtAt: '2026-11-24T09:13:46.800Z', sha256: sha, size: 4144542 });
    expect(r).toMatchObject({ build: 41, versionName: '0.1.41', size: 4144542, source: 'github' });
    expect(decodeReleaseBuild('<html>')).toBeNull();
  });
  it('picks the newest offer, the Mac on a tie', () => {
    const mac = { ...decodeDesktopBuild({ desktop: { build: 50, sha256: sha, size: 1 } })!, source: 'mac' as const };
    const gh = decodeReleaseBuild({ build: 52, sha256: sha, size: 1 });
    expect(pickUpdate(mac, gh, 45)?.source).toBe('github');
    expect(pickUpdate(mac, { ...gh!, build: 50 }, 45)?.source).toBe('mac');
    expect(pickUpdate(null, gh, 45)?.build).toBe(52);
    expect(pickUpdate(mac, null, 50)).toBeNull();
    expect(pickUpdate(null, gh, 0)).toBeNull();
  });
});
