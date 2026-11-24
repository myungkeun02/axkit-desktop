import { memo, useEffect, useId, useState } from 'react';
import { fileUrl } from '../platform/tauri';

// A bot's face: the Mac's picture when it sends one (R13), otherwise a little clay figure — a smooth matte body
// and two eyes whose shape shows how the bot is doing. Same rules as the iOS app's ClayCharacter.

type Mood = 'happy' | 'proud' | 'cheeky' | 'calm' | 'focused' | 'worried' | 'sleepy' | 'surprised';

/** FNV-1a with a final mix, like the iOS app, so similar names still land far apart. */
export function clayHash(text: string): number {
  let x = 0xcbf29ce484222325n;
  const mask = (1n << 64n) - 1n;
  for (const b of new TextEncoder().encode(text)) x = ((x ^ BigInt(b)) * 0x100000001b3n) & mask;
  x ^= x >> 33n;
  x = (x * 0xff51afd7ed558ccdn) & mask;
  x ^= x >> 33n;
  return Number(x % 2147483647n);
}

export function moodFor(status: string | undefined, seed: string, ordinal?: number): Mood {
  if (status === 'working') return 'focused';
  if (status === 'waiting') return 'worried';
  if (status === 'off') return 'sleepy';
  const cheerful: Mood[] = ['happy', 'proud', 'cheeky', 'calm', 'surprised'];
  return cheerful[(ordinal !== undefined ? ordinal * 2 : clayHash(seed + 'mood')) % cheerful.length];
}

function hsb(h: number, s: number, b: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return b - b * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `rgb(${Math.round(f(5) * 255)}, ${Math.round(f(3) * 255)}, ${Math.round(f(1) * 255)})`;
}

const HUES = [0.97, 0.01, 0.14, 0.27, 0.42, 0.48, 0.55, 0.6, 0.7, 0.78, 0.86];

function blobPath(seed: number, cx: number, cy: number, rx: number, ry: number): string {
  const p1 = (seed % 628) / 100, p2 = (Math.floor(seed / 628) % 628) / 100;
  const pts: string[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * 2 * Math.PI;
    let r = 1 + 0.01 * Math.sin(3 * a + p1) + 0.006 * Math.sin(5 * a + p2);
    if (Math.sin(a) > 0) r += 0.05 * Math.sin(a) * Math.abs(Math.cos(a));
    pts.push(`${(cx + Math.cos(a) * r * rx * 0.96).toFixed(2)},${(cy + Math.sin(a) * r * ry * 0.96).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function Eye({ mood, x, y, left }: { mood: Mood; x: number; y: number; left: boolean }) {
  const ink = '#262626';
  const line = { stroke: ink, strokeWidth: 3.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (mood) {
    case 'happy': case 'proud':
      return <path d={`M${x - 5},${y + 2} Q${x},${y - 6} ${x + 5},${y + 2}`} {...line} />;
    case 'sleepy': case 'calm':
      return <rect x={x - 5} y={y - 1.5} width={10} height={3} rx={1.5} fill={ink} />;
    case 'focused':
      return left ? <path d={`M${x - 3.5},${y - 4} L${x + 3.5},${y} L${x - 3.5},${y + 4}`} {...line} />
        : <path d={`M${x + 3.5},${y - 4} L${x - 3.5},${y} L${x + 3.5},${y + 4}`} {...line} />;
    case 'worried':
      return <ellipse className="blink" cx={x} cy={y + 2} rx={3.5} ry={4.5} fill={ink} transform={`rotate(${left ? -12 : 12} ${x} ${y + 2})`} />;
    default: {
      const big = mood === 'surprised';
      return <ellipse className="blink" cx={x} cy={y} rx={big ? 4.5 : 3.75} ry={big ? 5.5 : 4.75} fill={ink} />;
    }
  }
}

/** Drawn once per (name, status, size): the shape and hash math no longer run on every redraw of a room. */
export const ClayFigure = memo(function ClayFigure({ seed, status, ordinal, size, still }: { seed: string; status?: string; ordinal?: number; size: number; still?: boolean }) {
  const id = useId().replace(/:/g, '');
  const h = clayHash(seed + '#shape');
  const hue = HUES[(ordinal !== undefined ? ordinal * 4 : clayHash(seed + '#hue')) % HUES.length];
  const sat = hue === 0.14 ? 0.55 : 0.48;
  const body = hsb(hue, sat, 0.97), light = hsb(hue, 0.18, 1), dark = hsb(hue, 0.62, 0.72);
  const mood = moodFor(status, seed, ordinal);
  const path = blobPath(h, 50, 54, 40, 36);
  const delay = `${-(h % 997) / 100}s`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={`clay mood-${mood}${still ? ' still' : ''}`} style={{ flex: 'none', overflow: 'visible' }}>
      <defs>
        <radialGradient id={`l${id}`} cx="0.32" cy="0.25" r="0.6"><stop offset="0" stopColor={light} stopOpacity="0.9" /><stop offset="1" stopColor={light} stopOpacity="0" /></radialGradient>
        <linearGradient id={`d${id}`} x1="0" y1="0.5" x2="0" y2="1"><stop offset="0" stopColor={dark} stopOpacity="0" /><stop offset="1" stopColor={dark} stopOpacity="0.55" /></linearGradient>
        <filter id={`b${id}`}><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>
      <ellipse cx="50" cy="94" rx="30" ry="4" fill="#000" opacity="0.13" filter={`url(#b${id})`} className="clay-shadow" style={{ animationDelay: delay }} />
      <g className="clay-body" style={{ animationDelay: delay }}>
        <path d={path} fill={body} />
        <path d={path} fill={`url(#l${id})`} />
        <path d={path} fill={`url(#d${id})`} />
        <path d={path} fill="none" stroke={dark} strokeOpacity="0.35" strokeWidth="2" filter={`url(#b${id})`} />
        <ellipse cx="32" cy="34" rx="11" ry="5" fill="#fff" opacity="0.55" transform="rotate(-28 32 34)" filter={`url(#b${id})`} />
        <g className="clay-eyes" style={{ animationDelay: delay }}>
          <Eye mood={mood} x={41.5} y={56} left />
          <Eye mood={mood} x={58.5} y={56} left={false} />
        </g>
      </g>
      {mood === 'sleepy' && (
        <g className="zzz" fill="var(--text2)" fontWeight="900" fontFamily="ui-rounded, -apple-system">
          <text x="72" y="30" fontSize="16" style={{ animationDelay: '0s' }}>z</text>
          <text x="80" y="18" fontSize="12" style={{ animationDelay: '0.8s' }}>z</text>
        </g>
      )}
    </svg>
  );
});

/** Server picture (https or `files/<id>`) when there is one, otherwise the clay figure. */
export function BotAvatar({ name, size = 40, avatar, status, ordinal }: { name: string; size?: number; avatar?: string; status?: string; ordinal?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    void fileUrl(avatar).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [avatar]);
  if (src) return <img src={src} alt="" width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', flex: 'none' }} onError={() => setSrc(null)} />;
  // Only a big face moves; the many small faces in rooms and lists hold still (status still shows in the eyes) — every moving
  // one re-drew its blurred SVG each frame and kept the window busy (same rule as the iOS app).
  return <ClayFigure seed={name} status={status} ordinal={ordinal} size={size} still={size < 72} />;
}
