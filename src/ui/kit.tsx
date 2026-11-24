import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText } from '../core/api';
import { openLink } from '../platform/tauri';

// Shared building blocks, the same set as the iOS app's Theme.swift.

// ---------- icons (simple line drawings, no emoji) ----------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const Icon = {
  chat: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3.2A2.5 2.5 0 0 1 4 11.5z" /><path d="M17 9h.5A2.5 2.5 0 0 1 20 11.5v4a2.5 2.5 0 0 1-1 2V20l-3-2h-4a2.5 2.5 0 0 1-2-1" /></svg>,
  seal: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3l2.2 1.6 2.7-.2.9 2.6 2.3 1.4-.8 2.6.8 2.6-2.3 1.4-.9 2.6-2.7-.2L12 21l-2.2-1.6-2.7.2-.9-2.6-2.3-1.4.8-2.6-.8-2.6 2.3-1.4.9-2.6 2.7.2z" /><path d="M8.8 12.2l2.2 2.2 4.2-4.6" /></svg>,
  doc: () => <svg viewBox="0 0 24 24" {...P}><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>,
  calendar: () => <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  more: () => <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18.5" cy="12" r="1.8" /></svg>,
  people: () => <svg viewBox="0 0 24 24" {...P}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16.5 14c2.4 0 4 1.5 4.5 4" /></svg>,
  chevron: () => <svg viewBox="0 0 12 12" className="chevron" {...P} strokeWidth={2}><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>,
  back: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.2}><path d="M15 5l-7 7 7 7" /></svg>,
  forward: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.2}><path d="M9 5l7 7-7 7" /></svg>,
  up: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.4}><path d="M12 19V5M6 11l6-6 6 6" /></svg>,
  check: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>,
  search: () => <svg viewBox="0 0 24 24" {...P} strokeWidth={2}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>,
  scope: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="6.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></svg>,
  mac: () => <svg viewBox="0 0 24 24" {...P}><rect x="4" y="9" width="16" height="7" rx="2" /><path d="M7 19h10" /></svg>,
  wave: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 12h1M7.5 8v8M11 5v14M14.5 8v8M18 10.5v3M20.5 12h-.5" /></svg>,
  wand: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 19L15 9M14 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM19 12l.6-1.2L21 10l-1.4-.8L19 8l-.6 1.2L17 10l1.4.8z" /></svg>,
  repeat: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" /></svg>,
  won: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><path d="M7.5 9l2 6.5L12 9l2.5 6.5 2-6.5M7 11.5h10" /></svg>,
  chart: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 20V12M10 20V6M15 20v-9M20 20V9" /></svg>,
  bolt: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><path d="M13 6.5L9 13h3.5l-1 4.5L15.5 11H12z" /></svg>,
  tiers: () => <svg viewBox="0 0 24 24" {...P}><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" /></svg>,
  cpu: () => <svg viewBox="0 0 24 24" {...P}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></svg>,
  sparkle: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>,
  box: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 7.5L12 4l8 3.5v9L12 20l-8-3.5zM4 7.5l8 3.5 8-3.5M12 11v9" /></svg>,
  plug: () => <svg viewBox="0 0 24 24" {...P}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" /></svg>,
  info: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>,
  bubble: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4z" /></svg>,
  check2: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3l7 3v5.5c0 4.2-3 7.6-7 9.5-4-1.9-7-5.3-7-9.5V6z" /><path d="M8.8 12.2l2.2 2.2 4.2-4.4" /></svg>,
  thumbUp: () => <svg viewBox="0 0 24 24" {...P}><path d="M7 11v9H4v-9zM7 11l4-7c1.4 0 2.3 1.1 2 2.5L12.5 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7" /></svg>,
  thumbUpFill: () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round"><path d="M7 11v9H4v-9zM7 11l4-7c1.4 0 2.3 1.1 2 2.5L12.5 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7z" /></svg>,
  copy: () => <svg viewBox="0 0 24 24" {...P}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>,
  paperclip: () => <svg viewBox="0 0 24 24" {...P}><path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.6 17.3a1.7 1.7 0 0 1-2.4-2.4L15 7" /></svg>,
  globe: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" /></svg>,
  clock: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  checklist: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 7l1.5 1.5L8 6M4 13l1.5 1.5L8 12M4 19l1.5 1.5L8 18M11 7h9M11 13h9M11 19h9" /></svg>,
  mic: () => <svg viewBox="0 0 24 24" {...P}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></svg>,
  person: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.7-3.8 3.4-6 7-6s6.3 2.2 7 6" /></svg>,
  stop: () => <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
};

/** SF Symbol names the server may send (R9 `icon`) mapped to our drawings. */
export function iconFor(name?: string): () => ReactNode {
  if (!name) return Icon.sparkle;
  if (name.includes('shippingbox')) return Icon.box;
  if (name.includes('chart')) return Icon.chart;
  if (name.includes('calendar')) return Icon.calendar;
  if (name.includes('doc.badge.clock')) return Icon.clock;
  if (name.includes('doc')) return Icon.doc;
  if (name.includes('globe')) return Icon.globe;
  if (name.includes('checklist')) return Icon.checklist;
  return Icon.sparkle;
}

// ---------- layout pieces ----------
export function Panel({ children, tight, className }: { children: ReactNode; tight?: boolean; className?: string }) {
  return <div className={`panel${tight ? ' tight' : ''}${className ? ' ' + className : ''}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="card-header" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <div className="title" role="heading" aria-level={3}>{title}</div>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Row({ title, detail, trailing, onClick, titleClass, chevron }: {
  title: ReactNode; detail?: ReactNode; trailing?: ReactNode; onClick?: () => void; titleClass?: string; chevron?: boolean;
}) {
  return (
    <div className={`row${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}>
      <div className="grow">
        <div className={`row-title${titleClass ? ' ' + titleClass : ''}`}>{title}</div>
        {detail ? <div className="detail">{detail}</div> : null}
      </div>
      {trailing}
      {chevron && <Icon.chevron />}
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="list">{children}</div>;
}

export function MenuRow({ icon: I, title, detail, onClick }: { icon: () => ReactNode; title: string; detail?: ReactNode; onClick: () => void }) {
  return (
    <div className="row clickable menu-row" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}>
      <span className="menu-icon"><I /></span>
      <div className="grow">
        <div className="row-title">{title}</div>
        {detail && <div className="detail">{detail}</div>}
      </div>
      <Icon.chevron />
    </div>
  );
}

export type Kind = 'primary' | 'secondary' | 'danger';

export function Button({ kind = 'secondary', full, small, center, busy, disabled, onClick, children, title }: {
  kind?: Kind | 'plain'; full?: boolean; small?: boolean; center?: boolean; busy?: boolean; disabled?: boolean;
  onClick?: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button type="button" title={title} className={`btn ${kind}${full ? ' full' : ''}${small ? ' small' : ''}${center ? ' center' : ''}`} disabled={disabled || busy} onClick={onClick}>
      {children}
      {busy && <span className="spinner spin" />}
    </button>
  );
}

export function KV({ title, items }: { title: string; items: { k: string; v: ReactNode; cls?: string }[] }) {
  return (
    <Panel>
      <CardHeader title={title} />
      <List>{items.map((i) => <Row key={i.k} title={i.k} trailing={<span className={i.cls ?? 'secondary'} style={{ textAlign: 'right' }}>{i.v}</span>} />)}</List>
    </Panel>
  );
}

export function Empty({ icon: I = Icon.info, title, message, children }: { icon?: () => ReactNode; title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <I />
      <div className="t">{title}</div>
      {message && <div className="m">{message}</div>}
      {children}
    </div>
  );
}

export function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className={`check${on ? ' on' : ''}`} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => onChange(!on)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!on); } }}>
      <span className="box">{on && <Icon.check />}</span>
      <span>{children}</span>
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}

export function Meter({ value, color }: { value: number; color?: string }) {
  return <div className="meter"><div style={{ width: `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`, background: color }} /></div>;
}

export function Spinner() { return <span className="spinner" />; }

export function Sheet({ title, onClose, children, right }: { title: string; onClose: () => void; children: ReactNode; right?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-dim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="head">
          <div className="side"><button className="btn plain small" onClick={onClose}>닫기</button></div>
          <h2>{title}</h2>
          <div className="side" style={{ textAlign: 'right' }}>{right}</div>
        </div>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}

// ---------- loading a server view ----------
export type Loadable<T> = { state: 'loading' } | { state: 'loaded'; value: T } | { state: 'failed'; message: string };

/** Loads once (and again when `deps` change); `reload` keeps the old value on screen while it works. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], keepOnError = false): [Loadable<T>, () => Promise<void>] {
  const [state, setState] = useState<Loadable<T>>({ state: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;
  const current = useRef(state);
  current.current = state;
  const reload = useCallback(async () => {
    try {
      const value = await loadRef.current();
      setState({ state: 'loaded', value });
    } catch (e) {
      if (keepOnError && current.current.state === 'loaded') return;
      setState({ state: 'failed', message: errorText(e) });
    }
  }, [keepOnError]);
  useEffect(() => {
    setState((s) => (s.state === 'loaded' ? s : { state: 'loading' }));
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state, reload];
}

export function Loaded<T>({ value, retry, children }: { value: Loadable<T>; retry: () => void; children: (v: T) => ReactNode }) {
  if (value.state === 'loading') return <div className="center-fill" style={{ padding: 60 }}><Spinner /><span>불러오는 중…</span></div>;
  if (value.state === 'failed') {
    return (
      <Empty title="불러오지 못했어요" message={value.message}>
        <Button kind="primary" onClick={retry}>다시 해 보기</Button>
      </Empty>
    );
  }
  return <>{children(value.value)}</>;
}

// ---------- markdown (safe: builds React elements, never HTML) ----------
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    else {
      const label = t.slice(1, t.indexOf(']('));
      const url = m[2];
      out.push(<a key={`${key}-${i++}`} title={url} onClick={(e) => { e.preventDefault(); void openLink(url); }}>{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Parsed again only when the text changes (every room redraw used to re-parse every bubble). */
export const Markdown = memo(function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 3);
      const content = inline(h[2], k);
      blocks.push(level === 1 ? <h1 key={k++}>{content}</h1> : level === 2 ? <h2 key={k++}>{content}</h2> : <h3 key={k++}>{content}</h3>);
      i++;
      continue;
    }
    if (/^\s*([-*•])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•])\s+/, ''));
      blocks.push(<ul key={k++}>{items.map((t, j) => <li key={j}>{inline(t, j)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push(<ol key={k++}>{items.map((t, j) => <li key={j}>{inline(t, j)}</li>)}</ol>);
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k++}>{inline(body.join('\n'), k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*•]\s|\s*\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join('\n'), k)}</p>);
  }
  return <div className="md selectable">{blocks}</div>;
});
