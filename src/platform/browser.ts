import type { RawReply, Transport } from '../core/api';
import type { ConnInfo, Platform, StreamStateName } from '../core/session';

// Development only (`npm run dev` in a normal browser, no Tauri): talks to the mock Mac through Vite's proxy
// (vite.config.ts → 127.0.0.1:47795). Never part of the app build: main.tsx only loads it when import.meta.env.DEV
// and Tauri is absent. The real app keeps the token in Rust.

let token = '';
let remote = false;
const eventCbs = new Set<(d: string) => void>();
const stateCbs = new Set<(s: StreamStateName) => void>();
let abort: AbortController | null = null;

async function pair(): Promise<ConnInfo> {
  try {
    const res = await fetch('/m/p/dev/app', { method: 'POST', body: JSON.stringify({ code: '123456' }) });
    token = (await res.json()).token;
    return { mode: 'mock', connected: true, host: '127.0.0.1:47795 (브라우저 미리보기)', devBuild: true };
  } catch {
    return { mode: 'mock', connected: false, problem: '가짜 맥이 꺼져 있어요. npm run mock 을 켜 주세요.', devBuild: true };
  }
}

const json = async (res: Response): Promise<RawReply> => ({ status: res.status, body: await res.json().catch(() => null) });

const transport: Transport = {
  async call(method, path, query, body) {
    const url = new URL(`/m/v1/app/${path}`, location.origin);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    return json(await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  },
  async upload(path, bytes, headers) {
    return json(await fetch(`/m/v1/app/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: bytes as BodyInit }));
  },
};

async function stream(after: number, signal: AbortSignal) {
  let last = after;
  let backoff = 0;
  while (!signal.aborted) {
    stateCbs.forEach((cb) => cb('connecting'));
    try {
      const res = await fetch('/m/v1/app/stream', { headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': String(last) }, signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      stateCbs.forEach((cb) => cb('live'));
      backoff = 0;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
          const id = block.split('\n').find((l) => l.startsWith('id:'));
          if (id) last = Math.max(last, Number(id.slice(3)));
          if (data) eventCbs.forEach((cb) => cb(data));
        }
      }
    } catch { /* fall through to retry */ }
    if (signal.aborted) return;
    backoff = Math.min(Math.max(backoff * 2, 2), 60);
    stateCbs.forEach((cb) => cb('waiting'));
    await new Promise((r) => setTimeout(r, backoff * 1000));
  }
}

export const browserPlatform: Platform = {
  transport,
  connection: () => (new URLSearchParams(location.search).has('nolocal') && !token
    ? Promise.resolve({ mode: 'local', connected: false, problem: '맥의 ax-kit가 아직 켜지지 않았어요. ax-kit를 켜면 바로 붙어요.', devBuild: true, localAvailable: false })
    : token ? Promise.resolve(remote ? { mode: 'remote', connected: true, host: 'macmini.tail1234.ts.net (미리보기)', devBuild: true, deviceName: '작업용 맥북' } : { mode: 'mock', connected: true, host: '127.0.0.1:47795 (브라우저 미리보기)', devBuild: true }) : pair()),
  reconnect: pair,
  useMock: pair,
  useLocal: pair,
  async streamStart(after) { abort?.abort(); abort = new AbortController(); void stream(after, abort.signal); },
  async streamStop() { abort?.abort(); abort = null; },
  async onStreamEvent(cb) { eventCbs.add(cb); return () => eventCbs.delete(cb); },
  async onStreamState(cb) { stateCbs.add(cb); return () => stateCbs.delete(cb); },
  // Preview only: any 6 digits other than 000000 "pairs" with the mock Mac, so the screens can be looked at.
  async pairRemote(input) {
    const code = 'link' in input ? /[?&]c=(\d{6})/.exec(input.link)?.[1] ?? '' : input.code.replace(/\D/g, '');
    if (code.length !== 6) throw '코드는 숫자 6자리예요.';
    if (code === '000000') throw '코드가 맞지 않아요. 4번 더 해 볼 수 있어요.';
    const info = await pair();
    remote = true;
    return { ...info, mode: 'remote', host: 'macmini.tail1234.ts.net (미리보기)', deviceName: '작업용 맥북' };
  },
  async forgetRemote() { remote = false; return pair(); },
  async onServerChanged() { return () => {}; },
  async nudge() { /* the browser preview retries on its own */ },
};

/** `files/<id>` through the Vite proxy (browser preview only). */
export async function browserFile(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`/m/v1/app/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(String(res.status));
  return res.arrayBuffer();
}

/** Browser preview only: §22 picture stream through the Vite proxy. */
export function browserLiveStream(onEvent: (event: string, data: string) => void): () => void {
  const abort = new AbortController();
  void (async () => {
    let backoff = 1000;
    while (!abort.signal.aborted) {
      try {
        const res = await fetch('/m/v1/app/browser-live/stream', { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        onEvent('connection', 'live');
        backoff = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = block.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
            const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
            if (data) onEvent(ev, data);
          }
        }
      } catch { /* retry below */ }
      if (abort.signal.aborted) return;
      onEvent('connection', 'waiting');
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 10_000);
    }
  })();
  return () => abort.abort();
}
