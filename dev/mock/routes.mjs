// Places and routes (PROTOCOL-REQUESTS.md D7). Spec example for the server, which does this with
// 카카오 (place search → coordinates, car directions) and ODsay (transit directions), keys in the Mac Keychain.
// The app never calls those services; it only draws what this view returns.
//
// 1) Coordinates on calendar and today events (only when the place was found):
//      event.geo?: { lat, lng, address? }
// 2) capabilities: feature "routes", view { name: "routes", version: 1, actions: [] }
// 3) GET views/routes?date=YYYY-MM-DD (default today, owner's time zone) →
//    { date, provider: "kakao+odsay",
//      origin: { name: "집", lat, lng },                          // owner's home (set on the Mac)
//      legs: [ { eventId, title, arriveBy,                          // ISO, the event's start
//                from: { name, lat, lng }, to: { name, lat, lng, address? },
//                options: [ { mode: "transit"|"car"|"walk", durationMin, distanceKm, fareKrw?, tollKrw?,
//                             leaveAt,                              // ISO = arriveBy − durationMin − 5 min buffer
//                             summary,                              // "2호선 → 신분당선"
//                             steps: [ { mode: "walk"|"subway"|"bus"|"car", label, durationMin, line?, color? } ],
//                             path: [ [lng, lat], … ],             // simplified polyline
//                             recommended?: true } ],               // exactly one per leg
//                note? } ] }                                        // plain Korean, e.g. a tight gap between plans
//    Legs: home → first timed event with geo, then between consecutive ones. Events without geo (온라인, no place)
//    are skipped. Recommended = the faster one, unless within 5 minutes, then transit (cheaper).

const PLACES = {
  '모아카페': { lat: 37.5446, lng: 127.0559, address: '서울 성동구 성수이로 88' },
  '강남 사무실': { lat: 37.4979, lng: 127.0276, address: '서울 강남구 테헤란로 129' },
  '본가': { lat: 37.3837, lng: 127.1232, address: '경기 성남시 분당구 서현로 210' },
};
// Home is unset until the owner sets it (§16 setHome). MOCK_HOME=set starts with it set.
let HOME = process.env.MOCK_HOME === 'set' ? { name: '집', lat: 37.5559, lng: 126.9105 } : null;
const KNOWN_HOMES = [
  { match: /망원|마포/, home: { name: '집 (망원동)', lat: 37.5559, lng: 126.9105, address: '서울 마포구 망원동' } },
  { match: /성수|성동/, home: { name: '집 (성수동)', lat: 37.5446, lng: 127.0557, address: '서울 성동구 성수동' } },
  { match: /분당|판교/, home: { name: '집 (분당)', lat: 37.3827, lng: 127.1189, address: '경기 성남시 분당구' } },
];

// Real line colors (Seoul Metro / Gyeonggi bus).
const LINE = {
  '2호선': '#00A84D', '6호선': '#CD7C2F', '신분당선': '#D4003B', '수인분당선': '#FABE00', '간선버스': '#3366CC', '광역버스': '#E60012',
};

const geoFor = (place) => (place && PLACES[place] ? { ...PLACES[place] } : undefined);

function withGeo(events) {
  if (!Array.isArray(events)) return events;
  return events.map((e) => {
    const geo = geoFor(e.place);
    return geo ? { ...e, geo } : e;
  });
}

export async function augment({ path, json }) {
  if (!json || json.ok === false) return json;
  if (path === 'capabilities') {
    const features = json.features ?? [];
    const views = json.views ?? [];
    return {
      ...json,
      features: features.includes('routes') ? features : [...features, 'routes'],
      views: views.some((v) => v.name === 'routes') ? views : [...views, { name: 'routes', version: 1, actions: ['setHome'] }],
    };
  }
  if (path === 'views/calendar' && json.data?.days) {
    return { ...json, data: { ...json.data, days: json.data.days.map((d) => ({ ...d, events: withGeo(d.events) })) } };
  }
  if (path === 'views/today' && json.data) {
    return { ...json, data: { ...json.data, events: withGeo(json.data.events) } };
  }
  return json;
}

// ---------- geometry ----------
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A road-ish polyline: goes mostly along one axis first, then the other, with small bends. `bend` varies car vs transit. */
function roadPath(a, b, bend) {
  const pts = [[a.lng, a.lat]];
  const steps = 10;
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.min(1, t * (1 + bend));
    const ty = Math.max(0, (t - bend * 0.35) / (1 - bend * 0.35));
    const wiggle = Math.sin(t * Math.PI * 3) * 0.0025 * (bend > 0.3 ? 1 : -1);
    pts.push([+(a.lng + dx * tx + wiggle).toFixed(5), +(a.lat + dy * ty - wiggle * 0.6).toFixed(5)]);
  }
  pts.push([b.lng, b.lat]);
  return pts;
}

function transitPlan(to) {
  if (to.address?.includes('분당')) {
    return { summary: '2호선 → 신분당선 → 버스', steps: [['subway', '2호선', 0.35], ['subway', '신분당선', 0.4], ['bus', '광역버스', 0.25]] };
  }
  if (to.address?.includes('강남구')) return { summary: '2호선', steps: [['subway', '2호선', 1]] };
  if (to.address?.includes('성동구')) return { summary: '6호선 → 2호선', steps: [['subway', '6호선', 0.4], ['subway', '2호선', 0.6]] };
  return { summary: '간선버스', steps: [['bus', '간선버스', 1]] };
}

function options(from, to, arriveBy) {
  const d = km(from, to);
  const arrive = Date.parse(arriveBy);
  const leave = (min) => new Date(arrive - (min + 5) * 60_000).toISOString();

  const carKm = +(d * 1.35).toFixed(1);
  const carMin = Math.round((carKm / 21) * 60 + 6);
  const toll = to.address?.includes('분당') ? 1200 : 0;
  const car = {
    mode: 'car', durationMin: carMin, distanceKm: carKm, ...(toll ? { tollKrw: toll } : {}), leaveAt: leave(carMin),
    summary: toll ? '강변북로 → 분당수서로' : d > 6 ? '강변북로' : '시내 길', steps: [{ mode: 'car', label: '자동차', durationMin: carMin }],
    path: roadPath(from, to, 0.55),
  };

  const plan = transitPlan(to);
  const rideKm = d * 1.2;
  const rideMin = Math.round((rideKm / 30) * 60);
  const walkA = 6, walkB = 5, transfers = plan.steps.length - 1;
  const transitMin = walkA + rideMin + walkB + transfers * 4;
  const fare = 1400 + Math.max(0, Math.ceil((rideKm - 10) / 5)) * 100 + (plan.steps.some((s) => s[1] === '광역버스') ? 1600 : 0);
  const steps = [{ mode: 'walk', label: '걷기', durationMin: walkA }];
  plan.steps.forEach(([mode, line, share], i) => {
    steps.push({ mode, label: line, line, color: LINE[line], durationMin: Math.max(2, Math.round(rideMin * share + (i > 0 ? 4 : 0))) });
  });
  steps.push({ mode: 'walk', label: '걷기', durationMin: walkB });
  const transit = {
    mode: 'transit', durationMin: transitMin, distanceKm: +rideKm.toFixed(1), fareKrw: fare, leaveAt: leave(transitMin),
    summary: plan.summary, steps, path: roadPath(from, to, 0.15),
  };

  const list = [transit, car];
  if (d < 1.5) {
    const walkMin = Math.round(((d * 1.25) / 4.5) * 60);
    list.push({ mode: 'walk', durationMin: walkMin, distanceKm: +(d * 1.25).toFixed(1), leaveAt: leave(walkMin), summary: '걸어서',
      steps: [{ mode: 'walk', label: '걷기', durationMin: walkMin }], path: roadPath(from, to, 0.3) });
  }
  const best = car.durationMin + 5 < transit.durationMin ? car : transit;
  best.recommended = true;
  return list;
}

async function day(date, token, upstream) {
  const cal = await upstream(`/m/v1/app/views/calendar?month=${date.slice(0, 7)}`, token);
  const events = withGeo(cal?.data?.days?.find((d) => d.date === date)?.events ?? [])
    .filter((e) => !e.allDay && e.geo)
    .sort((a, b) => a.start.localeCompare(b.start));
  const legs = [];
  let from = HOME;
  let prev = null;
  for (const e of events) {
    const to = { name: e.place, ...e.geo };
    const opts = options(from, to, e.start);
    const leg = { eventId: e.id, title: e.title, arriveBy: e.start, from: { name: from.name, lat: from.lat, lng: from.lng }, to, options: opts };
    const rec = opts.find((o) => o.recommended);
    if (prev?.end && Date.parse(rec.leaveAt) < Date.parse(prev.end)) {
      leg.note = `'${prev.title}'이(가) 끝나기 ${Math.round((Date.parse(prev.end) - Date.parse(rec.leaveAt)) / 60_000)}분 전에 나가야 해요.`;
    }
    legs.push(leg);
    from = to;
    prev = e;
  }
  return { date, provider: 'kakao+odsay', origin: HOME, legs };
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export async function handle({ req, path, url, token, send, res, upstream }) {
  // POST views/routes/setHome {query} | {lat, lng, name?} → {home}
  if (req.method === 'POST' && path === 'views/routes/setHome') {
    const body = await readJson(req);
    let home = null;
    if (typeof body.lat === 'number' && typeof body.lng === 'number') home = { name: String(body.name ?? '집'), lat: body.lat, lng: body.lng };
    else if (typeof body.query === 'string' && body.query.trim()) home = KNOWN_HOMES.find((k) => k.match.test(body.query))?.home ?? null;
    if (!home) { send(res, 400, { ok: false, error: 'shape', message: '그 주소를 찾지 못했어요. 동 이름(예: 망원동)으로 적어 주세요.' }); return true; }
    HOME = home;
    send(res, 200, { ok: true, view: 'routes', action: 'setHome', data: { home } });
    return true;
  }
  if (req.method !== 'GET' || path !== 'views/routes') return false;
  const date = url.searchParams.get('date') ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { send(res, 400, { ok: false, error: 'query' }); return true; }
  if (!HOME) { send(res, 200, { ok: true, view: 'routes', version: 1, data: { date, provider: 'kakao+odsay', origin: null, legs: [], note: '집 위치를 정하면 일정 사이 길과 나갈 시간을 알려 드려요.' } }); return true; }
  send(res, 200, { ok: true, view: 'routes', version: 1, data: await day(date, token, upstream) });
  return true;
}
