import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../core/api';
import { decodeDictation, DICTATION_MAX_SEC, DICTATION_MIN_SEC, meterOf, MIC_DENIED, MIC_SILENT, NOTHING_HEARD, rmsDb, SILENT_DB } from '../core/dictation';
import type { Session } from '../core/session';
import { cancelDictation } from '../platform/tauri';

// §30 받아쓰기 for one message box: record with the Mac's microphone (the same MediaRecorder setup as 회의 녹음),
// send the bytes to `POST dictation`, hand the words to the box. Nothing is kept: the audio lives only in memory.

export type DictationPhase = 'idle' | 'recording' | 'transcribing';

export function useDictation(session: Session, onText: (text: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [problem, setProblem] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const parts = useRef<Blob[]>([]);
  /** Bumped by every cancel: an answer for an older recording is dropped. */
  const gen = useRef(0);
  const finishing = useRef(false);
  /** The loudest moment of this recording (dBFS); a recording that never got above SILENT_DB is not sent. */
  const peak = useRef(-Infinity);
  const meter = useRef<{ ctx: AudioContext; frame: number } | null>(null);
  const textSink = useRef(onText);
  textSink.current = onText;

  const stopMeter = () => {
    const m = meter.current;
    meter.current = null;
    if (!m) return;
    cancelAnimationFrame(m.frame);
    void m.ctx.close().catch(() => {});
    setLevel(0);
  };
  /** Listens to the same microphone stream for the level meter (nothing is recorded or sent from here). */
  const startMeter = (s: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let shown = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        const db = rmsDb(buf);
        if (db > peak.current) peak.current = db;
        const now = performance.now();
        if (now - shown > 80) { shown = now; setLevel(meterOf(db)); }
        if (meter.current) meter.current.frame = requestAnimationFrame(tick);
      };
      meter.current = { ctx, frame: requestAnimationFrame(tick) };
      void ctx.resume().catch(() => {});
    } catch { meter.current = null; peak.current = 0; /* no meter: never block the upload on it */ }
  };

  const release = () => {
    stopMeter();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    media.current = null;
    parts.current = [];
  };

  const say = (words: string) => setProblem(words);
  useEffect(() => {
    if (!problem) return;
    const t = setTimeout(() => setProblem(null), 6000);
    return () => clearTimeout(t);
  }, [problem]);

  const start = useCallback(async () => {
    if (media.current) return;
    setProblem(null);
    const my = ++gen.current;
    let s: MediaStream;
    try {
      // No voice processing: in WKWebView it can hand back silence, and the Mac's whisper copes with noise itself.
      s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      say(MIC_DENIED);
      return;
    }
    if (my !== gen.current) { s.getTracks().forEach((t) => t.stop()); return; }
    const type = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(s, { mimeType: type, audioBitsPerSecond: 32_000 });
    stream.current = s;
    media.current = rec;
    peak.current = -Infinity;
    startMeter(s);
    parts.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.current.push(e.data); };
    rec.onerror = () => {
      if (my !== gen.current) return;
      gen.current++;
      release();
      setStartedAt(null);
      setPhase('idle');
      say('녹음이 멈췄어요. 마이크를 확인하고 다시 눌러 주세요.');
    };
    rec.start(1000);
    const at = Date.now();
    setStartedAt(at);
    setNow(at);
    setPhase('recording');
  }, []);

  /** Stops and sends to the Mac. */
  const finish = useCallback(async () => {
    const rec = media.current;
    if (!rec || !startedAt || finishing.current) return;
    finishing.current = true;
    const my = gen.current;
    // Already stopped by itself (the microphone went away): use what was recorded. Otherwise wait for the last
    // piece, but never hang the button on a recorder that does not say it stopped.
    if (rec.state !== 'inactive') {
      await new Promise<void>((resolve) => { rec.onstop = () => resolve(); setTimeout(resolve, 3000); try { rec.stop(); } catch { resolve(); } });
    }
    finishing.current = false;
    const blob = new Blob(parts.current, { type: rec.mimeType });
    const seconds = (Date.now() - startedAt) / 1000;
    const loudest = peak.current;
    release();
    setStartedAt(null);
    if (my !== gen.current) return;
    if (seconds < DICTATION_MIN_SEC || blob.size === 0) { setPhase('idle'); say('너무 짧아요. 말한 뒤에 다시 눌러 주세요.'); return; }
    if (loudest < SILENT_DB) { setPhase('idle'); say(MIC_SILENT); return; }
    setPhase('transcribing');
    try {
      const answer = decodeDictation(await session.api.dictate(new Uint8Array(await blob.arrayBuffer()), (rec.mimeType || 'audio/mp4').split(';')[0]));
      if (my !== gen.current) return;
      if (answer.text) textSink.current(answer.text);
      else say(answer.message ?? NOTHING_HEARD);
    } catch (e) {
      if (my !== gen.current) return;
      say(errorText(e, '받아쓰지 못했어요. 다시 해 주세요.'));
    }
    setPhase('idle');
  }, [session, startedAt]);

  /** Esc while recording, or a click while the Mac is writing: nothing is sent, nothing goes in the box. */
  const cancel = useCallback(() => {
    gen.current++;
    finishing.current = false;
    if (phase === 'transcribing') void cancelDictation();
    const rec = media.current;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
    release();
    setStartedAt(null);
    setPhase('idle');
  }, [phase]);

  const toggle = useCallback(() => {
    if (phase === 'idle') void start();
    else if (phase === 'recording') void finish();
    else cancel();
  }, [phase, start, finish, cancel]);

  // The clock, and the 3-minute stop.
  useEffect(() => {
    if (phase !== 'recording' || !startedAt) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if ((n - startedAt) / 1000 >= DICTATION_MAX_SEC) void finish();
    }, 250);
    return () => clearInterval(t);
  }, [phase, startedAt, finish]);

  // Leaving the room (or the box going away) drops a recording in progress.
  useEffect(() => () => { gen.current++; const rec = media.current; if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  return { phase, elapsed, level, problem, toggle, cancel, clearProblem: () => setProblem(null) };
}
