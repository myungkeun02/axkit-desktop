import { useSyncExternalStore } from 'react';
import { errorText } from '../core/api';
import { recordingId, sendRecording, type PendingRecording } from '../core/recordings';
import type { Session } from '../core/session';

// Records a meeting with the Mac's microphone (MediaRecorder, AAC in an mp4 box when WebKit allows) and sends it
// to the ax-kit server, which writes it up as 회의록 (R14). Nothing is kept on disk here; the server keeps the audio.

interface State { startedAt: number | null; pending: { id: string; startedAt: string; durationSec: number; progress: number }[]; problem: string | null }

/** Finished recordings wait here until the Mac has every piece, so quitting mid-upload loses nothing. */
const DB = 'axkit-recordings';
function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('queue', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function store(op: 'put' | 'delete', value: PendingRecording | string) {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction('queue', 'readwrite');
    if (op === 'put') tx.objectStore('queue').put(value); else tx.objectStore('queue').delete(value as string);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
async function loadQueue(): Promise<PendingRecording[]> {
  const d = await db();
  if (!d) return [];
  return new Promise((resolve) => {
    const req = d.transaction('queue').objectStore('queue').getAll();
    req.onsuccess = () => resolve((req.result as PendingRecording[]).sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
    req.onerror = () => resolve([]);
  });
}

class Recorder {
  state: State = { startedAt: null, pending: [], problem: null };
  private listeners = new Set<() => void>();
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private parts: Blob[] = [];
  private queue: PendingRecording[] = [];
  private sending = false;
  session: Session | null = null;

  /** Picks up recordings that were waiting when the app last quit. */
  async restore() {
    const saved = await loadQueue();
    const known = new Set(this.queue.map((r) => r.id));
    this.queue.push(...saved.filter((r) => !known.has(r.id)));
    this.publishQueue();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = () => this.state;
  private set(patch: Partial<State>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(); }
  private publishQueue() {
    this.set({ pending: this.queue.map((r) => ({ id: r.id, startedAt: r.startedAt, durationSec: r.durationSec, progress: r.received / Math.max(1, Math.ceil(r.bytes.length / (4 * 1024 * 1024))) })) });
  }

  async start() {
    if (this.media) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      this.session?.say('마이크를 쓸 수 없어요. 시스템 설정 › 개인정보 보호 › 마이크에서 ax-kit를 켜 주세요.');
      return;
    }
    const type = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    this.media = new MediaRecorder(this.stream, { mimeType: type, audioBitsPerSecond: 32_000 });
    this.parts = [];
    this.media.ondataavailable = (e) => { if (e.data.size) this.parts.push(e.data); };
    this.media.start(10_000);
    this.set({ startedAt: Date.now(), problem: null });
  }

  async stop() {
    const media = this.media;
    const startedAt = this.state.startedAt;
    if (!media || !startedAt) return;
    await new Promise<void>((resolve) => { media.onstop = () => resolve(); media.stop(); });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.media = null;
    this.stream = null;
    const blob = new Blob(this.parts, { type: media.mimeType });
    this.parts = [];
    this.set({ startedAt: null });
    const durationSec = (Date.now() - startedAt) / 1000;
    if (durationSec < 2 || blob.size === 0) { this.session?.say('녹음이 너무 짧아요.'); return; }
    const rec: PendingRecording = { id: recordingId(), startedAt: new Date(startedAt).toISOString(), durationSec, contentType: (media.mimeType || 'audio/mp4').split(';')[0], bytes: new Uint8Array(await blob.arrayBuffer()), received: 0 };
    this.queue.push(rec);
    await store('put', rec);
    this.publishQueue();
    this.session?.say('녹음을 맥으로 보낼게요. 정리되면 문서에 생겨요.');
    await this.send();
  }

  /** Sends whatever is waiting; called after a recording ends and whenever the connection comes back. */
  async send() {
    const session = this.session;
    if (this.sending || !session) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const rec = this.queue[0];
        await sendRecording(rec, (i, total, piece) => session.api.uploadChunk(rec.id, i, total, piece, rec.startedAt, rec.durationSec, rec.contentType), () => this.publishQueue());
        this.queue.shift();
        await store('delete', rec.id);
        this.publishQueue();
      }
    } catch (e) {
      this.set({ problem: errorText(e) });
    } finally {
      this.sending = false;
    }
  }
}

export const recorder = new Recorder();
export const useRecorder = () => useSyncExternalStore(recorder.subscribe, recorder.get);
