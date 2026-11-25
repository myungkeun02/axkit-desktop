import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { RawReply, Transport } from '../core/api';
import type { ConnInfo, PairInput, Platform, StreamStateName } from '../core/session';

// The webview side of src-tauri/src/lib.rs. The token never comes here; Rust adds it to every request.

const transport: Transport = {
  call: (method, path, query, body) => invoke<RawReply>('api', { method, path, query: query ?? null, body: body ?? null }),
  // Tauri puts its own Content-Type on a raw invoke; the real one rides as x-content-type (lib.rs upload_headers).
  upload: (path, bytes, headers) => {
    const { 'content-type': type, ...rest } = headers;
    return invoke<RawReply>('upload', bytes, { headers: { ...rest, ...(type ? { 'x-content-type': type } : {}), 'x-ax-path': path } });
  },
};

export const tauriPlatform: Platform = {
  transport,
  connection: () => invoke<ConnInfo>('connection'),
  reconnect: () => invoke<ConnInfo>('reconnect'),
  useMock: (baseUrl) => invoke<ConnInfo>('use_mock', { baseUrl }),
  useLocal: () => invoke<ConnInfo>('use_local'),
  streamStart: (after, reset) => invoke('stream_start', { after, reset }),
  streamStop: () => invoke('stream_stop'),
  onStreamEvent: (cb) => listen<{ data: string }>('ax://event', (e) => cb(e.payload.data)),
  onStreamState: (cb) => listen<{ state: StreamStateName; retryInSec?: number }>('ax://stream', (e) => cb(e.payload.state, e.payload.retryInSec)),
  pairRemote: (input: PairInput) => invoke<ConnInfo>('pair_remote', 'link' in input ? { link: input.link } : { address: input.address, code: input.code, nonce: input.nonce }),
  forgetRemote: () => invoke<ConnInfo>('forget_remote'),
  onServerChanged: (cb) => listen('ax://server-changed', () => cb()),
  nudge: () => invoke('stream_nudge'),
};

const fileCache = new Map<string, Promise<string | null>>();

/** `files/<id>` (needs the token, fetched in Rust) or an https picture, as something an <img> can show. */
export function fileUrl(ref: string | undefined, contentType = 'image/png'): Promise<string | null> {
  if (!ref) return Promise.resolve(null);
  if (ref.startsWith('https://')) return Promise.resolve(ref);
  if (!ref.startsWith('files/')) return Promise.resolve(null);
  let p = fileCache.get(ref);
  if (!p) {
    const bytes = '__TAURI_INTERNALS__' in window || !import.meta.env.DEV
      ? invoke<ArrayBuffer>('get_file', { path: ref })
      : import('./browser').then((b) => b.browserFile(ref));
    p = bytes
      .then((buf) => URL.createObjectURL(new Blob([buf], { type: contentType })))
      .catch(() => { fileCache.delete(ref); return null; });
    fileCache.set(ref, p);
  }
  return p;
}

/** Opens an https link in the default browser (never anything else). Only on the owner's click. */
export const openLink = (url: string) => invoke('open_link', { url });

const inTauri = () => '__TAURI_INTERNALS__' in window;

/** Dock badge and the number by the menu bar icon. */
export const setAttention = (count: number) => (inTauri() ? invoke('set_attention', { count }).catch(() => {}) : Promise.resolve());

/** A Mac notification. */
export const notify = (title: string, body: string) => (inTauri() ? invoke('notify', { title, body }).catch(() => {}) : Promise.resolve());

/** The menu bar menu asks to open a section ("결재 보기"). */
export const onNavigate = (cb: (section: string) => void) => (inTauri() ? listen<{ section: string }>('ax://navigate', (e) => cb(e.payload.section)) : Promise.resolve(() => {}));

/** The owner's switch in 설정 및 연결 (kept in this window only). */
export const notificationsOn = () => { try { return localStorage.getItem('notify') !== 'off'; } catch { return true; } };
export const setNotificationsOn = (on: boolean) => { try { localStorage.setItem('notify', on ? 'on' : 'off'); } catch { /* blocked */ } };

export interface SavedFile { path: string; name: string }

/** §19: save `files/<id>` to ~/Downloads. Rejects with "gone" when the Mac already deleted it (kept 24h). */
export async function saveFile(ref: string, name: string): Promise<SavedFile> {
  if (inTauri()) return invoke<SavedFile>('save_file', { path: ref, name });
  // Browser preview (development only): hand the bytes to the browser's own download.
  const { browserFile } = await import('./browser');
  let buf: ArrayBuffer;
  try { buf = await browserFile(ref); } catch (e) { throw String(e).includes('404') ? 'gone' : e; }
  const url = URL.createObjectURL(new Blob([buf]));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { path: '', name };
}
export const previewFile = (path: string) => (inTauri() && path ? invoke('preview_file', { path }) : Promise.resolve());
export const revealFile = (path: string) => (inTauri() && path ? invoke('reveal_file', { path }) : Promise.resolve());

/** §22: the browser-live picture stream while that screen is open. Returns a stop function. */
export async function liveStream(onEvent: (event: string, data: string) => void): Promise<() => void> {
  if (inTauri()) {
    const off = await listen<{ event: string; data: string }>('ax://live', (e) => onEvent(e.payload.event, e.payload.data));
    await invoke('live_start');
    return () => { off(); void invoke('live_stop'); };
  }
  const { browserLiveStream } = await import('./browser');
  return browserLiveStream(onEvent);
}

/** §22 fallback: one picture as a blob URL (the caller revokes the previous one), or null when no page is open. */
export async function liveFrame(): Promise<string | null> {
  try {
    const buf = inTauri()
      ? await invoke<ArrayBuffer>('live_frame')
      : await import('./browser').then((b) => b.browserFile('browser-live/frame'));
    return URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
  } catch {
    return null;
  }
}

// ---------- the widget window (menu bar drop-down, or pinned on top) ----------

/** This page runs in the widget window (label "widget"); `?widget` in a browser preview. */
export function isWidgetWindow(): boolean {
  if (!inTauri()) return new URLSearchParams(location.search).has('widget');
  const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
  return meta?.metadata?.currentWindow?.label === 'widget';
}

/** The widget shares the main window's stream: it never restarts or stops it. */
export const widgetPlatform: Platform = {
  ...tauriPlatform,
  streamStart: (after) => invoke('stream_ensure', { after }),
  streamStop: () => Promise.resolve(),
};

export const widgetPin = (pinned: boolean) => (inTauri() ? invoke('widget_pin', { pinned }).catch(() => {}) : Promise.resolve());
export const widgetHide = () => (inTauri() ? invoke('widget_hide').catch(() => {}) : Promise.resolve());
/** Bring the main window up, on that screen. */
export const widgetOpenMain = (section?: 'home' | 'approvals' | 'calendar' | 'work') =>
  (inTauri() ? invoke('widget_open_main', { section: section ?? null }).catch(() => {}) : Promise.resolve());
export const widgetPinned = () => { try { return localStorage.getItem('widget-pinned') === 'on'; } catch { return false; } };
export const rememberWidgetPinned = (on: boolean) => { try { localStorage.setItem('widget-pinned', on ? 'on' : 'off'); } catch { /* blocked */ } };

/** An `axkit://pair` link macOS opened the app with (install script or a click). Checked in Rust (https only). */
export interface OpenedPairLink { link: string; host: string; problem?: string | null }
/** The link that started the app, if the page was not listening yet. In the browser preview: `?pairlink=<link>`. */
export const takePairLink = (): Promise<OpenedPairLink | null> => {
  if (inTauri()) return invoke<OpenedPairLink | null>('take_pair_link').catch(() => null);
  const link = new URLSearchParams(location.search).get('pairlink');
  if (!link) return Promise.resolve(null);
  try { const u = new URL(new URL(link).searchParams.get('u') ?? ''); return Promise.resolve({ link, host: u.host }); }
  catch { return Promise.resolve({ link: '', host: '', problem: '링크가 이상해요. 다시 복사해 주세요.' }); }
};
export const onPairLink = (cb: (l: OpenedPairLink) => void) => (inTauri() ? listen<OpenedPairLink>('ax://pair-link', (e) => cb(e.payload)) : Promise.resolve(() => {}));

/** §30: stop the dictation request the Mac is working on (the connection is closed; nothing comes back). */
export const cancelDictation = () => (inTauri() ? invoke('cancel_dictation').catch(() => {}) : Promise.resolve());

/** §32 바꾸기: Rust fetches and checks the Mac's build, starts the swap helper and quits (an error comes back as words). */
/** The public release's json (Rust fetches it; the page only reads the numbers). */
export const checkRelease = (): Promise<unknown> => (inTauri() ? invoke('check_release') : Promise.reject('미리보기'));
export const installRelease = (build: number) => (inTauri() ? invoke('install_release', { build }) : Promise.reject('미리보기에서는 앱을 바꿀 수 없어요.'));
export const installUpdate = (sha256: string) => (inTauri() ? invoke('install_update', { sha256 }) : Promise.reject('미리보기에서는 앱을 바꿀 수 없어요.'));
