// §32 앱 업데이트: feature `app-updates`, view `app-updates` {desktop?: {build, versionName, builtAt, sha256, size}}.
// Nothing is offered until /dev/update?build=<N> (a bigger N than the app's build shows "새 버전이 있어요");
// /dev/update clears it. The zip itself is not served (바꾸기 only works in the real app).

let build = 0;

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const features = json.features ?? [];
  return { ...json, features: features.includes('app-updates') ? features : [...features, 'app-updates'] };
}

export function devReset(params = new URLSearchParams()) {
  build = Number(params.get('build') ?? 0) || 0;
}

export async function handle({ req, res, path, send }) {
  if (req.method !== 'GET' || path !== 'views/app-updates') return false;
  const desktop = build ? { build, versionName: `0.1.${build}`, builtAt: new Date().toISOString(), sha256: 'ab'.repeat(32), size: 4_144_604 } : undefined;
  send(res, 200, { ok: true, view: 'app-updates', version: 1, data: desktop ? { desktop } : {} });
  return true;
}
