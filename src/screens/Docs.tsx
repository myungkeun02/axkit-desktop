import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { hasView } from '../core/api';
import { ago, relative } from '../core/format';
import type { DocGraphView, DocumentDetail } from '../core/views';
import { areasOf, documentOf, groupsFromGraph, type KnowledgeDocument } from '../core/knowledge';
import { findRange, matches, snippet } from '../core/koreanSearch';
import { previewText } from '../core/chatText';
import { Button, CardHeader, Empty, Icon, List, Loaded, Markdown, Panel, Row, Sheet, useLoad } from '../ui/kit';
import { Banners } from './Banners';

type Source = 'docgraph' | 'knowledge';
interface ListedDoc { key: string; id: string; source: Source; title: string; summary?: string; updatedAt?: string; section: string }
interface ListedSection { id: string; label: string; summary?: string; docs: ListedDoc[] }

/** `nav.doc` carries where a document came from, so it always opens through that view ("knowledge|area/x.md"). */
const docKey = (source: Source, id: string) => `${source}|${id}`;
function parseDocKey(key: string): { source: Source; id: string } {
  const i = key.indexOf('|');
  const head = key.slice(0, i);
  return i > 0 && (head === 'knowledge' || head === 'docgraph') ? { source: head, id: key.slice(i + 1) } : { source: 'docgraph', id: key };
}

/** Document bodies read for search, kept while the app runs. */
const bodies = new Map<string, string>();

/** 문서: a plain tree (분야 → 문서) with the newest on top, and a search through titles, 분야, summaries and the
 * documents themselves — spaces ignored, part of a word or first sounds ("ㄱㅈ") enough, hits marked. */
export function Docs() {
  const { session, nav, go } = useApp();
  const hasKnowledge = hasView(session.capabilities, 'knowledge');
  const hasGraph = hasView(session.capabilities, 'docgraph');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const [graphState, reloadGraph] = useLoad(() => (hasGraph ? session.api.view<DocGraphView>('docgraph') : Promise.resolve(null)), [hasGraph]);
  const [areaState, reloadAreas] = useLoad(() => (hasKnowledge ? session.api.view<unknown>('knowledge').then(areasOf) : Promise.resolve(null)), [hasKnowledge]);
  const open = (key: string | null) => go({ doc: key });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'f') { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'Escape' && nav.doc && !(e.target as HTMLElement).closest('.sheet')) go({ doc: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav.doc, go]);

  const sections = useMemo(() => {
    const out: ListedSection[] = [];
    if (areaState.state === 'loaded' && areaState.value) {
      for (const a of areaState.value) out.push({ id: `k:${a.id}`, label: a.label, summary: a.summary,
        docs: a.docs.map((d) => ({ key: docKey('knowledge', d.id), id: d.id, source: 'knowledge' as const, title: d.title, summary: d.summary, updatedAt: d.updatedAt, section: a.label })) });
    }
    if (graphState.state === 'loaded' && graphState.value) {
      for (const g of groupsFromGraph(graphState.value, () => '')) out.push({ id: `g:${g.id}`, label: g.label, summary: g.summary,
        docs: g.docs.map((d) => ({ key: docKey('docgraph', d.id), id: d.id, source: 'docgraph' as const, title: d.title, summary: d.summary, updatedAt: d.updatedAt, section: g.label })) });
    }
    return out.filter((x) => x.docs.length);
  }, [areaState, graphState]);
  const loading = (hasKnowledge && areaState.state === 'loading') || (hasGraph && graphState.state === 'loading');
  const failed = areaState.state === 'failed' ? areaState : graphState.state === 'failed' ? graphState : null;
  const current = nav.doc ? parseDocKey(nav.doc) : null;

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side" />
        <h1 data-tauri-drag-region>문서</h1>
        <div className="side right" />
      </header>
      <Banners />
      {!hasGraph && !hasKnowledge && session.capabilities.views.length > 0 ? (
        <Empty icon={Icon.doc} title="맥에 아직 문서가 없어요" message="맥의 비서를 새 버전으로 올리면 여기에 문서가 보여요." />
      ) : (
        <div className="split">
          <div className="split-list wide">
            <div style={{ padding: '12px 12px 4px' }}>
              <input ref={search} className="field" placeholder="제목·내용·분야로 찾기 (⌘F)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="문서 찾기" />
            </div>
            <div className="scroll">
              {sections.length ? <DocTree sections={sections} query={query} selected={nav.doc} open={open} />
                : loading ? <div className="center-fill" style={{ padding: 40 }}><span className="spinner" /></div>
                : failed && failed.state === 'failed' ? <Empty title="불러오지 못했어요" message={failed.message}><Button kind="primary" onClick={() => { void reloadAreas(); void reloadGraph(); }}>다시 해 보기</Button></Empty>
                : <div className="secondary" style={{ padding: 16 }}>아직 쌓인 문서가 없어요. 대화하면 비서가 적어 둬요.</div>}
            </div>
          </div>
          {current ? (
            <aside className="side-pane doc-pane scroll grow" aria-label="문서">
              <DocumentBody key={nav.doc} id={current.id} source={current.source} highlight={query} onClose={() => open(null)} onOpen={(id) => open(docKey('docgraph', id))} />
            </aside>
          ) : (
            <div className="split-detail"><Empty icon={Icon.doc} title="문서를 골라 주세요" message="왼쪽에서 고르면 여기에 열려요." /></div>
          )}
        </div>
      )}
    </>
  );
}

/** Marks the first hit of the query inside a text. */
function Marked({ text, query }: { text: string; query: string }) {
  const r = query.trim() ? findRange(text, query) : null;
  if (!r) return <>{text}</>;
  return <>{text.slice(0, r[0])}<mark>{text.slice(r[0], r[1])}</mark>{text.slice(r[1])}</>;
}

/** Recent documents first, then 분야 folders (open one, see its documents newest first); with a query, the hits. */
function DocTree({ sections, query, selected, open }: { sections: ListedSection[]; query: string; selected: string | null; open: (key: string) => void }) {
  const { session } = useApp();
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const q = query.trim();
  const all = useMemo(() => { const seen = new Set<string>(); return sections.flatMap((x) => x.docs).filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true))); }, [sections]);

  // The first search reads every document (six at a time) so the words inside them can be found.
  useEffect(() => {
    if (!q) return;
    // When the Mac searches its documents itself (§21.6), its own documents are not downloaded one by one (~40 MB).
    const macSearches = hasView(session.capabilities, 'knowledge');
    const todo = all.filter((d) => !bodies.has(d.key) && !(macSearches && d.source === 'knowledge'));
    if (!todo.length) return;
    let live = true;
    let done = 0;
    let failed = 0;
    setProgress({ done, total: todo.length, failed });
    const queue = [...todo];
    const worker = async () => {
      for (let d = queue.shift(); d && live; d = queue.shift()) {
        try {
          const body = d.source === 'knowledge'
            ? documentOf(await session.api.view<unknown>('knowledge', { doc: d.id }))?.markdown
            : (await session.api.view<{ document: DocumentDetail | null }>('docgraph', { doc: d.id })).document?.markdown;
          if (body) bodies.set(d.key, body); else failed++;
        } catch { failed++; }
        done++;
        // A redraw every few documents, not one per document (each redraw searches everything again).
        if (live && (done % 8 === 0 || done === todo.length)) setProgress({ done, total: todo.length, failed });
      }
    };
    void Promise.all(Array.from({ length: 6 }, worker)).then(() => { if (live) setProgress(failed ? { done, total: todo.length, failed } : null); });
    return () => { live = false; };
  }, [q !== '', all, session]);

  // §21.6: the Mac searches every document itself (more than the list holds); results come first, the app adds what it found.
  const [fromMac, setFromMac] = useState<{ q: string; hits: { d: ListedDoc; line?: string }[] } | null>(null);
  useEffect(() => {
    if (!q || !hasView(session.capabilities, 'knowledge')) { setFromMac(null); return; }
    let live = true;
    const t = setTimeout(() => {
      void session.api.view<{ results?: { id: string; title: string; area?: string; areaLabel?: string; updatedAt?: string; snippet?: string }[] }>('knowledge', { q, limit: '50' })
        .then((r) => { if (live && Array.isArray(r?.results)) setFromMac({ q, hits: r.results.map((x) => ({ d: { key: docKey('knowledge', x.id), id: x.id, source: 'knowledge' as const, title: x.title, updatedAt: x.updatedAt, section: x.areaLabel ?? x.area ?? '문서' }, line: x.snippet ? previewText(x.snippet, 120) : undefined })) }); })
        .catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, session]);

  const row = (d: ListedDoc, line?: string) => (
    <button key={d.key} className={`list-row${selected === d.key ? ' on' : ''}`} onClick={() => open(d.key)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis"><Marked text={d.title} query={q} /></div>
        {line && <div className="footnote ellipsis"><Marked text={line} query={q} /></div>}
        <div className="footnote ellipsis" style={{ color: 'var(--text3)' }}><Marked text={d.section} query={q} />{d.updatedAt ? ` · ${ago(d.updatedAt)} 고침` : ''}</div>
      </div>
    </button>
  );

  // Searched once per query / arrival of documents, and behind the typing (useDeferredValue) so keys never wait on it.
  const deferredQ = useDeferredValue(q);
  const local = useMemo(() => {
    if (!deferredQ) return [];
    const mac = fromMac?.q === deferredQ ? fromMac.hits : [];
    const macKeys = new Set(mac.map((h) => h.d.key));
    return all.filter((d) => !macKeys.has(d.key)).flatMap((d) => {
      if (matches(d.title, deferredQ)) return [{ d, line: d.summary, rank: 0 }];
      if (d.summary && matches(d.summary, deferredQ)) return [{ d, line: d.summary, rank: 1 }];
      if (matches(d.section, deferredQ)) return [{ d, line: d.summary, rank: 2 }];
      const body = bodies.get(d.key);
      const line = body ? snippet(body, deferredQ) : null;
      return line ? [{ d, line, rank: 3 }] : [];
    }).sort((a, b) => a.rank - b.rank || Date.parse(b.d.updatedAt ?? '0') - Date.parse(a.d.updatedAt ?? '0'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQ, all, fromMac, progress?.done]);

  if (q) {
    const mac = fromMac?.q === q ? fromMac.hits : [];
    const hits: { d: ListedDoc; line?: string | null }[] = [...mac, ...local];
    const reading = progress && progress.done < progress.total ? progress : null;
    return (
      <>
        <div className="list-head">찾은 문서 {hits.length}개{reading ? ` · 내용 읽는 중 ${reading.done}/${reading.total}` : ''}</div>
        {hits.map((h) => row(h.d, h.line ?? undefined))}
        {!hits.length && !reading && (
          <div className="secondary" style={{ padding: 16, lineHeight: 1.5 }}>
            ‘{q}’이(가) 들어간 문서가 없어요. 문서 {all.length}개의 제목·분야·내용을 모두 찾아봤어요.
            {progress?.failed ? ` 내용을 읽지 못한 문서가 ${progress.failed}개 있어요.` : ''}<br />띄어쓰기는 상관없고, 첫소리(예: ㄱㅈ)로도 찾을 수 있어요.
          </div>
        )}
      </>
    );
  }

  const recent = all.filter((d) => d.updatedAt).sort((a, b) => Date.parse(b.updatedAt!) - Date.parse(a.updatedAt!)).slice(0, 5);
  return (
    <>
      {recent.length > 0 && (
        <section style={{ marginBottom: 8 }}>
          <div className="list-head">최근 고친 문서</div>
          {recent.map((d) => row(d, d.summary))}
        </section>
      )}
      <div className="list-head">분야별</div>
      {sections.map((x) => {
        const isOpen = unfolded.has(x.id);
        const docs = [...x.docs].sort((a, b) => Date.parse(b.updatedAt ?? '0') - Date.parse(a.updatedAt ?? '0'));
        return (
          <section key={x.id}>
            <button className="area-head" aria-expanded={isOpen} onClick={() => setUnfolded((f) => { const n = new Set(f); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })}>
              <span style={{ width: 12, height: 12, display: 'inline-flex', transform: isOpen ? 'rotate(90deg)' : undefined, color: 'var(--text3)' }}><Icon.forward /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="bold">{x.label}</span> <span className="footnote">{x.docs.length}개</span>
                {x.summary && <span className="footnote" style={{ display: 'block' }}>{x.summary}</span>}
              </span>
            </button>
            {isOpen && <div style={{ paddingLeft: 18 }}>{docs.map((d) => row(d, d.summary))}</div>}
          </section>
        );
      })}
    </>
  );
}

/** The title is already on top (a first heading that repeats it goes); machine source notes read as "대화 기록". */
export function readableDoc(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const m = /^#{1,3}\s+(.*)$/.exec(lines[0] ?? '');
  if (m && m[1].trim() === title.trim()) lines.shift();
  return lines.join('\n')
    .replace(/transcript:[A-Za-z0-9-]+(\.jsonl)?(:[^\s)+,]*)?/g, '대화 기록')
    .replace(/memory\/[A-Za-z0-9._-]+\.md/g, '메모');
}

/** One document: title, text, linked documents, "틀린 곳 알려 주기". */
export function DocumentBody({ id, onClose, source = 'docgraph', onOpen, highlight = '' }: { id: string; onClose?: () => void; source?: 'docgraph' | 'knowledge'; onOpen?: (id: string) => void; highlight?: string }) {
  const { session, go } = useApp();
  const [state, reload] = useLoad<DocumentDetail | KnowledgeDocument | null>(() => (source === 'knowledge'
    ? session.api.view<unknown>('knowledge', highlight.trim() ? { doc: id, q: highlight.trim() } : { doc: id }).then(documentOf)
    : session.api.view<{ document: DocumentDetail | null }>('docgraph', { doc: id }).then((d) => d.document)), [id, source]);
  const [asking, setAsking] = useState(false);
  const [fix, setFix] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18 }}>
      <Loaded value={state} retry={reload}>
        {(doc) => doc ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '1.375rem', fontWeight: 700 }} className="selectable">{doc.title}</div>
                {doc.updatedAt && <div className="footnote">{relative(doc.updatedAt)} 고침</div>}
              </div>
              {onClose && <button className="btn plain small" onClick={onClose} title="닫기 (Esc)">닫기</button>}
            </div>
            {highlight.trim() && (() => { const line = snippet(doc.markdown, highlight, 140); return line ? <div className="found-line">찾은 곳: <Marked text={line} query={highlight} /></div> : null; })()}
            <Panel><Markdown source={readableDoc(doc.markdown, doc.title)} /></Panel>
            {doc.related && doc.related.length > 0 && (
              <Panel tight>
                <CardHeader title="관련 문서" />
                <List>{doc.related.map((r) => <Row key={r.id} title={r.title} chevron onClick={() => (onOpen ? onOpen(r.id) : go({ doc: r.id }))} />)}</List>
              </Panel>
            )}
            <Button kind="secondary" full onClick={() => setAsking(true)}>틀린 곳이 있으면 비서에게 알려 주기</Button>
            {asking && (
              <Sheet title="무엇을 고칠까요?" onClose={() => setAsking(false)}>
                <textarea className="field" rows={3} autoFocus placeholder="예: 투자 목표는 50억이에요" value={fix} onChange={(e) => setFix(e.target.value)} />
                <Button kind="primary" full disabled={!fix.trim()} onClick={() => {
                  session.send(`[문서 고치기: ${doc.title}] ${fix.trim()}`, '');
                  setFix('');
                  setAsking(false);
                  session.say('비서에게 보냈어요. 고치면 알려 드릴게요.');
                }}>비서에게 보내기</Button>
              </Sheet>
            )}
          </>
        ) : <Empty icon={Icon.doc} title="문서를 찾지 못했어요" />}
      </Loaded>
    </div>
  );
}

/** Full-page document (녹음 › 회의록). */
export function DocumentScreen({ id, onBack, backLabel = '문서' }: { id: string; onBack: () => void; backLabel?: string }) {
  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="side"><button className="btn plain small" onClick={onBack}><span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.back /></span>{backLabel}</button></div>
        <h1 data-tauri-drag-region />
        <div className="side right" />
      </header>
      <div className="scroll"><div className="page"><DocumentBody id={id} /></div></div>
    </>
  );
}
