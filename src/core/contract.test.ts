// Runs the protocol client against the iOS repo's mock Mac (the shared spec example), when it is next to this repo.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, type RawReply, type Transport } from './api';
import type { BotsView, CalendarView, DocGraphView } from './views';

const MOCK = fileURLToPath(new URL('../../../ax-kit-ios/dev/mock-server.mjs', import.meta.url));
// A free port of our own: other sessions may already run a mock on the usual ones.
let PORT = 0;
let BASE = '';
const freePort = () => new Promise<number>((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => { const p = (srv.address() as AddressInfo).port; srv.close(() => resolve(p)); });
});

class FetchTransport implements Transport {
  constructor(private token: string) {}
  async call(method: 'GET' | 'POST', path: string, query?: Record<string, string>, body?: unknown): Promise<RawReply> {
    const url = new URL(`${BASE}/m/v1/app/${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  async upload(path: string, bytes: Uint8Array, headers: Record<string, string>): Promise<RawReply> {
    const res = await fetch(`${BASE}/m/v1/app/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, ...headers }, body: bytes as BodyInit });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
}

describe.skipIf(!existsSync(MOCK))('against the mock Mac', () => {
  let mock: ChildProcess;
  let api: ApiClient;

  beforeAll(async () => {
    PORT = await freePort();
    BASE = `http://127.0.0.1:${PORT}`;
    mock = spawn(process.execPath, [MOCK, '--port', String(PORT)], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`${BASE}/m/p/dev/app`, { method: 'POST', body: JSON.stringify({ code: '123456' }) });
        const { token } = await res.json();
        api = new ApiClient(new FetchTransport(token));
        return;
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('mock did not start');
  });
  afterAll(() => { mock?.kill(); });

  it('reads capabilities, status and the event log', async () => {
    const caps = await api.capabilities();
    expect(caps.features).toContain('card-reply');
    const status = await api.status();
    const page = await api.events(0, 200);
    expect(page.events.length).toBeGreaterThan(5);
    expect(page.events.some((e) => e.type === 'delegation')).toBe(true);
    expect(page.events.some((e) => e.type === 'card' && e.remember)).toBe(true);
    expect(status.lastSeq).toBeGreaterThanOrEqual(page.events.at(-1)!.seq);
  });

  it('sends a message once per clientId', async () => {
    const a = await api.sendMessage({ text: '안녕', clientId: 'test-1' });
    const b = await api.sendMessage({ text: '안녕', clientId: 'test-1' });
    expect(b).toEqual({ seq: a.seq, duplicate: true });
  });

  it('answers a card with remember and gets 410 the second time', async () => {
    const r = await api.answerCard('deploy-login', { option: 'deploy:night' }, true, { id: 'deploy:night', label: '밤' });
    expect(r.state).toBe('approved');
    await expect(api.answerCard('deploy-login', { option: 'deploy:night' })).rejects.toMatchObject({ kind: 'gone' });
    const autonomy = await api.view<{ rules: { label: string }[] }>('autonomy');
    expect(autonomy.rules.some((x) => x.label.includes('검사를 통과한'))).toBe(true);
  });

  it('decodes the views the screens use', async () => {
    const bots = await api.view<BotsView>('bots');
    expect(bots.groups.length).toBeGreaterThan(1);
    const graph = await api.view<DocGraphView>('docgraph');
    expect(graph.nodes.length).toBeGreaterThan(5);
    const month = new Date().toISOString().slice(0, 7);
    const cal = await api.view<CalendarView>('calendar', { month });
    expect(cal.days.length).toBeGreaterThan(27);
    const added = await api.viewAction<{ id: string }>('calendar', 'add', { title: '치과', allDay: true, start: `${month}-20` });
    expect(added.id).toBeTruthy();
    await expect(api.view('nope')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('uploads recording pieces and resumes from what the Mac has', async () => {
    const r = await api.uploadChunk('r_test-1', 0, 2, new Uint8Array([1, 2, 3]), new Date().toISOString(), 60);
    expect(r).toEqual({ received: 1, complete: false });
    const done = await api.uploadChunk('r_test-1', 1, 2, new Uint8Array([4]), new Date().toISOString(), 60);
    expect(done.complete).toBe(true);
  });
});
