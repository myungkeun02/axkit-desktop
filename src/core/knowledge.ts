// 지식 모음 (view `knowledge`): documents the assistant keeps writing as you talk. Two server shapes, one for the app.
//   ax-hq (§7.6):  {areas:[{id,label,summary?,docs:[{id,title,summary?,updatedAt?}]}]}
//   ax-kit (§5.3): {documents:[{name,title,kind,lines}]}  → grouped by kind
// One document: {document:{id|name, title, markdown, updatedAt?, related?, lines?}} (null when missing).

export interface KnowledgeDoc { id: string; title: string; summary?: string; updatedAt?: string }
export interface KnowledgeArea { id: string; label: string; summary?: string; docs: KnowledgeDoc[] }
export interface KnowledgeDocument { id: string; title: string; markdown: string; updatedAt?: string; related?: { id: string; title: string }[] }

const KIND_LABEL: Record<string, string> = { readme: '개요', profile: '나', project: '프로젝트', area: '영역', changelog: '바뀐 것' };
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export function areasOf(raw: unknown): KnowledgeArea[] {
  const data = obj(raw);
  if (Array.isArray(data.areas)) {
    return data.areas.map((a) => obj(a)).filter((a) => str(a.id)).map((a) => ({
      id: a.id as string, label: str(a.label) ?? (a.id as string), summary: str(a.summary),
      docs: (Array.isArray(a.docs) ? a.docs : []).map((d) => obj(d)).filter((d) => str(d.id) ?? str(d.name))
        .map((d) => ({ id: (str(d.id) ?? str(d.name))!, title: str(d.title) ?? (str(d.id) ?? str(d.name))!, summary: str(d.summary), updatedAt: str(d.updatedAt) })),
    }));
  }
  if (Array.isArray(data.documents)) {
    const byKind = new Map<string, KnowledgeArea>();
    for (const d of data.documents.map((x) => obj(x))) {
      const id = str(d.name) ?? str(d.id);
      if (!id) continue;
      const kind = str(d.kind) ?? 'area';
      if (!byKind.has(kind)) byKind.set(kind, { id: kind, label: KIND_LABEL[kind] ?? kind, docs: [] });
      const lines = typeof d.lines === 'number' ? `${d.lines}줄` : undefined;
      byKind.get(kind)!.docs.push({ id, title: str(d.title) ?? id, summary: str(d.summary) ?? lines, updatedAt: str(d.updatedAt) });
    }
    const order = ['readme', 'profile', 'project', 'area', 'changelog'];
    return [...byKind.values()].sort((a, b) => (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99);
  }
  return [];
}

export function documentOf(raw: unknown): KnowledgeDocument | null {
  const d = obj(obj(raw).document);
  const id = str(d.id) ?? str(d.name);
  if (!id) return null;
  let markdown = typeof d.markdown === 'string' ? d.markdown : '';
  // ax-kit sends the learned lines separately; show them under the text when the markdown does not already hold them.
  if (Array.isArray(d.lines) && d.lines.length && !markdown.trim()) {
    markdown = d.lines.map((l) => `- ${str(obj(l).text) ?? ''}`).join('\n');
  }
  const related = Array.isArray(d.related) ? d.related.map((r) => obj(r)).filter((r) => str(r.id)).map((r) => ({ id: r.id as string, title: str(r.title) ?? (r.id as string) })) : undefined;
  return { id, title: str(d.title) ?? id, markdown, updatedAt: str(d.updatedAt), related };
}

/** Newest first, each document once (a document can sit in two areas). */
export function recentDocs(areas: KnowledgeArea[], limit = 6): (KnowledgeDoc & { area: string })[] {
  const seen = new Set<string>();
  return areas.flatMap((a) => a.docs.map((d) => ({ ...d, area: a.label })))
    .filter((d) => d.updatedAt)
    .sort((a, b) => Date.parse(b.updatedAt!) - Date.parse(a.updatedAt!))
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .slice(0, limit);
}

/** Finds in titles and summaries. */
export function searchDocs(areas: KnowledgeArea[], query: string): KnowledgeArea[] {
  const q = query.trim().toLowerCase();
  if (!q) return areas;
  return areas.map((a) => ({ ...a, docs: a.docs.filter((d) => d.title.toLowerCase().includes(q) || !!d.summary?.toLowerCase().includes(q)) })).filter((a) => a.docs.length);
}

/** Groups for the one 문서 list: the knowledge areas when the Mac has them, else docgraph layers (with their colour). */
export interface DocGroup extends KnowledgeArea { color?: string }

export function groupsFromGraph(graph: { layers: { id: string; label: string; summary?: string }[]; nodes: { id: string; title: string; layer: string; summary?: string; updatedAt?: string }[];
  tree?: { id: string; label: string; summary?: string; items?: { id: string; title: string; summary?: string; updatedAt?: string; related?: { id: string; title: string }[] }[] }[] }, colorOf: (i: number) => string): DocGroup[] {
  // §21.7: the Mac's list form (layer → item → related) when it sends one.
  if (Array.isArray(graph.tree) && graph.tree.length) {
    return graph.tree.map((l, i) => ({
      id: l.id, label: l.label, summary: l.summary, color: colorOf(i),
      docs: (l.items ?? []).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt,
        summary: [n.summary, n.related?.length ? `관련: ${n.related.slice(0, 3).map((r) => r.title).join(', ')}` : undefined].filter(Boolean).join(' · ') || undefined })),
    })).filter((g) => g.docs.length);
  }
  return graph.layers.map((l, i) => ({
    id: l.id, label: l.label, summary: l.summary, color: colorOf(i),
    docs: graph.nodes.filter((n) => n.layer === l.id).map((n) => ({ id: n.id, title: n.title, summary: n.summary, updatedAt: n.updatedAt })),
  })).filter((g) => g.docs.length);
}
