// A file shared from a team or bot room (server 8111cea): POST share with header x-channel lands in that room
// (400 for an unknown room). Feature `share-rooms` tells the app the Mac does this; an older Mac would put it in
// the main chat, so the app only offers + and drag-and-drop in rooms with the feature.

export async function augment({ path, json }) {
  if (path !== 'capabilities' || !json?.ok) return json;
  const features = json.features ?? [];
  return { ...json, features: features.includes('share-rooms') ? features : [...features, 'share-rooms'] };
}

export async function handle({ req, res, path, token, send, upstream, upstreamPost }) {
  const room = String(req.headers['x-channel'] ?? '').trim();
  if (req.method !== 'POST' || path !== 'share' || !room) return false;
  for await (const _ of req) { /* the bytes are not kept by this mock */ }
  const view = (await upstream('/m/v1/app/views/bots', token)).data;
  const rooms = new Set(view.groups.flatMap((g) => [...(g.teams ?? []).map((t) => t.channel), ...(g.bots ?? []).map((b) => b.channel), g.meetingChannel].filter(Boolean)));
  if (!rooms.has(room)) return send(res, 400, { ok: false, error: 'shape' }), true;
  const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '파일'));
  await upstreamPost('/m/v1/app/messages', token, { text: `파일을 보냈어요: ${name}`, channel: room });
  send(res, 200, { ok: true, seq: 0 });
  return true;
}
