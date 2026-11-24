// §32 앱 업데이트: the assistant's Mac builds this app itself and offers it to paired apps (no App Store).
// `views/app-updates` → `{ desktop?: {build, versionName, builtAt, sha256, size} }`; a bigger `build` than ours
// (the app repository's commit count, stamped at build time) means "새 버전이 있어요".

export interface DesktopBuild { build: number; versionName: string; builtAt?: string; sha256: string; size: number }

export function decodeDesktopBuild(data: unknown): DesktopBuild | null {
  const d = (data && typeof data === 'object' ? (data as Record<string, unknown>).desktop : null) as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object') return null;
  const build = typeof d.build === 'number' && Number.isInteger(d.build) && d.build > 0 ? d.build : null;
  const sha256 = typeof d.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(d.sha256.trim()) ? d.sha256.trim().toLowerCase() : null;
  const size = typeof d.size === 'number' && d.size > 0 ? d.size : null;
  if (build === null || sha256 === null || size === null) return null;
  return { build, versionName: typeof d.versionName === 'string' && d.versionName.trim() ? d.versionName.trim() : String(build), builtAt: typeof d.builtAt === 'string' ? d.builtAt : undefined, sha256, size };
}

/** Only a build newer than ours (and ours known: a dev build without a number never offers one). */
export const newerBuild = (offered: DesktopBuild | null, mine: number): DesktopBuild | null =>
  offered && mine > 0 && offered.build > mine ? offered : null;

export const UPDATE_DAY_MS = 24 * 3600 * 1000;
