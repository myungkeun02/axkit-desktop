import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { recorder } from './app/recorder';
import type { OutboxStorage, Pending } from './core/outbox';
import { Session, type ReadStorage } from './core/session';
import { checkRelease, isWidgetWindow, notificationsOn, notify, tauriPlatform, widgetPlatform } from './platform/tauri';
import { Widget } from './screens/Widget';
import { NoteLimiter, noteFor } from './core/notify';
import './ui/styles.css';
import { startTextSize } from './app/textSize';

startTextSize();

// The widget window (menu bar drop-down / pinned) is this same page with its own small session.
const widget = isWidgetWindow();

/** Unsent messages survive a restart (only text the owner typed; never tokens). Each window and each server keeps
 *  its own list, so words meant for one Mac never go to another. */
const outboxKey = widget ? 'outbox-widget' : 'outbox';
const readJson = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; } };
const writeJson = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } };
const storage: OutboxStorage = {
  // Lists from before servers had their own (one key) belong to this Mac's ax-kit.
  load: (scope) => readJson<Pending[]>(`${outboxKey}:${scope}`, scope === 'local' ? readJson<Pending[]>(outboxKey, []) : []),
  save: (scope, list) => { writeJson(`${outboxKey}:${scope}`, list); if (scope === 'local') { try { localStorage.removeItem(outboxKey); } catch { /* blocked */ } } },
};
/** Which rooms were read, per server (the widget only reads them). */
const reads: ReadStorage = {
  load: (scope) => readJson<Record<string, number>>(`read:${scope}`, {}),
  save: (scope, upTo) => { if (!widget) writeJson(`read:${scope}`, upTo); },
};

const inTauri = '__TAURI_INTERNALS__' in window;
const platform = inTauri || !import.meta.env.DEV ? (widget ? widgetPlatform : tauriPlatform) : (await import('./platform/browser')).browserPlatform;
const session = new Session(platform, storage, reads);
session.appBuild = __APP_BUILD__;
// The public release on GitHub; the browser preview reads the mock's stand-in (/dev/update?release=N).
session.checkRelease = inTauri ? checkRelease
  : import.meta.env.DEV ? () => fetch('/m/dev/release.json').then((r) => (r.ok ? r.json() : Promise.reject(r.status))) : null;
if (!widget) void session.refreshUpdate();
// §32: the Mac may have built a newer copy of this app; look once a day (and on every connect, session.ts).
if (!widget) setInterval(() => void session.refreshUpdate(), 24 * 3600 * 1000);

// Coming back to the window, waking from sleep, the network coming back: retry now instead of after the backoff.
const nudge = () => void session.nudge();
window.addEventListener('focus', nudge);
window.addEventListener('online', nudge);
// Sleep stops the clock for this page: a tick that comes much later than planned means the Mac just woke up.
let tick = Date.now();
setInterval(() => { const now = Date.now(); if (now - tick > 30_000) nudge(); tick = now; }, 10_000);

if (widget) {
  document.documentElement.classList.add('in-widget');
  void session.start();
  createRoot(document.getElementById('root')!).render(<StrictMode><Widget session={session} /></StrictMode>);
} else {
  startMain();
}

function startMain() {
  recorder.session = session;
  void recorder.restore();

  // Mac notifications for live events while the window is not in front (off in 설정 및 연결).
  const limiter = new NoteLimiter();
  session.onLiveEvent = (event) => {
    if (document.hasFocus() || !notificationsOn()) return;
    const note = noteFor(event, { assistantName: session.assistantName, roomTitle: (r) => session.roomTitle(r) });
    if (note) for (const n of limiter.offer(note)) void notify(n.title, n.body);
  };
  window.addEventListener('focus', () => limiter.reset());
  // While this Mac's ax-kit is not running yet, look for it every few seconds (it attaches by itself once it starts).
  void session.start({ autoReconnect: true });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App session={session} />
    </StrictMode>,
  );
}
