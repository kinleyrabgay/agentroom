import { derivedPurpose } from './index-md.js';
import type { ContextGraph, ModuleCard, ModuleNode } from './types.js';

/**
 * Docs generated from the context map: `docs/architecture.md` and `docs/decisions.md`.
 * Everything comes from the fact graph and the cards (no model calls), so a doc is only as stale as
 * the map. Generated parts sit between `<!-- agentroom:begin <id> -->` / `<!-- agentroom:end <id> -->`
 * markers; text outside them is the human's and is never touched.
 */

export type DocFileId = 'architecture' | 'decisions';

export const DOC_FILES: Record<DocFileId, string> = {
  architecture: 'docs/architecture.md',
  decisions: 'docs/decisions.md',
};

export interface DocSection {
  id: string;
  title: string;
  body: string;
}

export interface DocInput {
  graph: ContextGraph;
  /** Cards by module id (missing = no card yet). */
  cards: Record<string, ModuleCard | null>;
  repoName: string;
}

/** Above this many modules the diagram shows folders instead of modules. */
export const DIAGRAM_MODULE_LIMIT = 24;
/** Most edges drawn in the diagram. */
export const DIAGRAM_EDGE_LIMIT = 40;

const begin = (id: string) => `<!-- agentroom:begin ${id} -->`;
const end = (id: string) => `<!-- agentroom:end ${id} -->`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Top-level area of a module: its first folder, or "(root)". */
export function areaOf(dir: string): string {
  return dir ? dir.split('/')[0]! : '(root)';
}

/** Folder group for the diagram: first two folders (`src/server`), or the area. */
export function groupOf(dir: string): string {
  if (!dir) return '(root)';
  const parts = dir.split('/');
  return parts.slice(0, Math.min(2, parts.length)).join('/');
}

const purposeOf = (m: ModuleNode, input: DocInput) => input.cards[m.id]?.purpose?.trim() || derivedPurpose(m, input.graph);

function isCode(m: ModuleNode, g: ContextGraph): boolean {
  return m.files.some((f) => {
    const n = g.files[f]!;
    return !n.isTest && n.lang !== 'other';
  });
}

// ── architecture.md ────────────────────────────────────────────────────────

export function architectureSections(input: DocInput): DocSection[] {
  return [
    { id: 'overview', title: 'Overview', body: overview(input) },
    { id: 'diagram', title: 'Dependency diagram', body: diagram(input) },
    { id: 'modules', title: 'Modules', body: modulesTable(input) },
    { id: 'flows', title: 'Key flows', body: flows(input) },
  ];
}

function overview({ graph: g, repoName }: DocInput): string {
  const files = Object.values(g.files);
  const langs = new Map<string, number>();
  for (const f of files) if (f.lang !== 'other') langs.set(f.lang, (langs.get(f.lang) ?? 0) + 1);
  const langLine = [...langs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([l, n]) => `${l} (${n})`)
    .join(', ');
  const areas = new Map<string, ModuleNode[]>();
  for (const m of Object.values(g.modules)) areas.set(areaOf(m.dir), [...(areas.get(areaOf(m.dir)) ?? []), m]);
  const tests = files.filter((f) => f.isTest).length;
  const out = [
    `**${repoName}**: ${plural(files.length, 'file')} in ${plural(Object.keys(g.modules).length, 'module')}${tests ? `, ${plural(tests, 'test file')}` : ''}.`,
    langLine ? `Languages: ${langLine}.` : '',
    '',
    '| Area | Modules | Files |',
    '|---|---|---|',
    ...[...areas.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([a, ms]) => `| \`${a === '(root)' ? '.' : a + '/'}\` | ${ms.length} | ${ms.reduce((n, m) => n + m.files.length, 0)} |`),
  ];
  return out.filter((l, i) => l || i === 2).join('\n');
}

const mid = (s: string) => 'n_' + s.replace(/[^A-Za-z0-9]/g, '_');

function diagram({ graph: g }: DocInput): string {
  const modules = Object.values(g.modules).filter((m) => isCode(m, g) || Object.keys(m.dependents).length);
  const byModule = modules.length <= DIAGRAM_MODULE_LIMIT;
  const keyOf = (m: ModuleNode) => (byModule ? m.id : groupOf(m.dir));
  const nodes = new Map<string, { label: string; area: string; files: number; modules: number }>();
  for (const m of modules) {
    const k = keyOf(m);
    const n = nodes.get(k) ?? { label: byModule ? m.dir || '.' : k, area: areaOf(m.dir), files: 0, modules: 0 };
    n.files += m.files.length;
    n.modules++;
    nodes.set(k, n);
  }
  const owner = new Map(modules.map((m) => [m.id, keyOf(m)]));
  const weights = new Map<string, number>();
  for (const e of g.edges) {
    const a = owner.get(e.from);
    const b = owner.get(e.to);
    if (!a || !b || a === b) continue;
    weights.set(`${a}\u0000${b}`, (weights.get(`${a}\u0000${b}`) ?? 0) + e.weight);
  }
  const edges = [...weights.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, DIAGRAM_EDGE_LIMIT)
    .map(([k, w]) => {
      const [a, b] = k.split('\u0000') as [string, string];
      return { a, b, w };
    });
  const areas = new Map<string, string[]>();
  for (const [k, n] of nodes) areas.set(n.area, [...(areas.get(n.area) ?? []), k]);
  const lines = ['```mermaid', 'flowchart LR'];
  for (const [area, keys] of [...areas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  subgraph ${mid('area_' + area)}["${area === '(root)' ? '.' : area + '/'}"]`);
    for (const k of keys.sort()) {
      const n = nodes.get(k)!;
      const label = byModule ? `${n.label}<br/>${plural(n.files, 'file')}` : `${n.label}<br/>${plural(n.modules, 'module')} · ${plural(n.files, 'file')}`;
      lines.push(`    ${mid(k)}["${label.replace(/"/g, "'")}"]`);
    }
    lines.push('  end');
  }
  for (const e of edges) lines.push(`  ${mid(e.a)} -->|${e.w}| ${mid(e.b)}`);
  lines.push('```');
  const note = byModule
    ? 'Arrows point from a module to what it imports; numbers are import counts.'
    : `Folders (first two levels) with their modules; arrows point to what they import, numbers are import counts. ${weights.size > edges.length ? `Showing the ${edges.length} heaviest of ${weights.size} links.` : ''}`.trim();
  return `${note}\n\n${lines.join('\n')}`;
}

function modulesTable(input: DocInput): string {
  const g = input.graph;
  const areas = new Map<string, ModuleNode[]>();
  for (const m of Object.values(g.modules)) areas.set(areaOf(m.dir), [...(areas.get(areaOf(m.dir)) ?? []), m]);
  const out: string[] = [];
  for (const [area, ms] of [...areas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`### \`${area === '(root)' ? '.' : area + '/'}\``, '', '| Module | Folder | Files | Purpose |', '|---|---|---|---|');
    for (const m of ms.sort((a, b) => a.dir.localeCompare(b.dir)))
      out.push(`| \`${m.id}\` | \`${m.dir || '.'}/\` | ${m.files.length} | ${cell(purposeOf(m, input))}${input.cards[m.id]?.generatedAt ? '' : ' _(no card)_'} |`);
    out.push('');
  }
  return out.join('\n').trim();
}

function flows(input: DocInput): string {
  const g = input.graph;
  const out: string[] = [];

  // Entry modules: code nobody else imports, which imports others (CLIs, apps, servers).
  const code = Object.values(g.modules).filter((m) => isCode(m, g));
  const entries = code
    .filter((m) => !Object.keys(m.dependents).length && Object.keys(m.deps).length)
    .sort((a, b) => Object.keys(b.deps).length - Object.keys(a.deps).length || a.id.localeCompare(b.id))
    .slice(0, 5);
  if (entries.length) {
    out.push('**Call paths** (from each entry point, following its heaviest import that leads further):', '');
    for (const m of entries) {
      const path = [m.id];
      const seen = new Set(path);
      let cur = m;
      while (path.length < 7) {
        // Prefer a module that leads somewhere (has imports of its own); leaves like `shared` end the path.
        const goesOn = (id: string) => Object.keys(g.modules[id]!.deps).some((d) => !seen.has(d) && d !== id);
        const next = Object.entries(cur.deps)
          .filter(([id]) => !seen.has(id) && g.modules[id])
          .sort((a, b) => Number(goesOn(b[0])) - Number(goesOn(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (!next) break;
        path.push(next[0]);
        seen.add(next[0]);
        cur = g.modules[next[0]]!;
      }
      out.push(`- ${path.map((id) => `\`${id}\``).join(' → ')}`);
    }
    out.push('');
  }

  // HTTP routes and pages, grouped by module.
  const routes: { mod: string; name: string; file: string; line: number }[] = [];
  for (const m of code)
    for (const f of m.files)
      for (const s of g.files[f]!.symbols) if (s.kind === 'route') routes.push({ mod: m.id, name: s.name, file: f, line: s.line });
  if (routes.length) {
    const by = new Map<string, typeof routes>();
    for (const r of routes) by.set(r.mod, [...(by.get(r.mod) ?? []), r]);
    out.push(`**Routes** (${routes.length}):`, '');
    let shown = 0;
    for (const [mod, list] of [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      if (shown >= 40) break;
      const take = list.slice(0, Math.min(8, 40 - shown));
      shown += take.length;
      out.push(`- \`${mod}\`: ${take.map((r) => `\`${r.name}\` (\`${r.file}:${r.line}\`)`).join(', ')}${list.length > take.length ? `, +${list.length - take.length} more` : ''}`);
    }
    out.push('');
  }

  // The most depended-on modules, with their card's first entry point.
  const core = code
    .filter((m) => Object.keys(m.dependents).length >= 2)
    .sort((a, b) => Object.keys(b.dependents).length - Object.keys(a.dependents).length || a.id.localeCompare(b.id))
    .slice(0, 6);
  if (core.length) {
    out.push('**Core modules** (most imported):', '');
    for (const m of core) {
      const ep = input.cards[m.id]?.entryPoints[0];
      out.push(`- \`${m.id}\`, used by ${plural(Object.keys(m.dependents).length, 'module')}: ${cell(purposeOf(m, input))}${ep ? ` Start at ${ep.cite[0] ? `\`${ep.cite[0]}\`` : ''}: ${cell(ep.text)}` : ''}`);
    }
  }
  return out.join('\n').trim() || '_No entry points or routes found yet._';
}

// ── decisions.md ───────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\s*·\s*/;

export function decisionSections(input: DocInput): DocSection[] {
  const rows: { date: string; mod: string; text: string }[] = [];
  for (const [id, card] of Object.entries(input.cards))
    for (const d of card?.decisions ?? []) {
      const m = d.match(DATE_RE);
      rows.push({ date: m?.[1] ?? '', mod: id, text: m ? d.slice(m[0].length) : d });
    }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.mod.localeCompare(b.mod));
  const recent = rows.length
    ? ['| Date | Module | Decision |', '|---|---|---|', ...rows.slice(0, 25).map((r) => `| ${r.date || '—'} | \`${r.mod}\` | ${cell(r.text)} |`)].join('\n')
    : '_No decisions recorded yet. Bots add one to each module a finished goal touches; you can add your own on the Context page._';
  const byMod = new Map<string, typeof rows>();
  for (const r of rows) byMod.set(r.mod, [...(byMod.get(r.mod) ?? []), r]);
  const modules = [...byMod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, list]) => [`### \`${id}\``, '', ...list.map((r) => `- ${r.date ? `**${r.date}** · ` : ''}${r.text}`)].join('\n'))
    .join('\n\n');
  return [
    { id: 'recent', title: 'Recent decisions', body: recent },
    { id: 'by-module', title: 'By module', body: modules || '_None yet._' },
  ];
}

export function docSections(id: DocFileId, input: DocInput): DocSection[] {
  return id === 'architecture' ? architectureSections(input) : decisionSections(input);
}

const HEADERS: Record<DocFileId, string> = {
  architecture: '# Architecture\n\n> Generated by AgentRoom from the repo context map. Sections between `agentroom` markers are regenerated; write anything else outside them.',
  decisions: '# Decision log\n\n> Collected by AgentRoom from module cards (`.agentroom/context/modules/*.md`). Sections between `agentroom` markers are regenerated.',
};

// ── Merge, sections, diff ──────────────────────────────────────────────────

const BLOCK_RE = /<!-- agentroom:begin ([\w-]+) -->\n?([\s\S]*?)\n?<!-- agentroom:end \1 -->/g;

/** Generated blocks in a doc on disk, by section id. */
export function readBlocks(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(BLOCK_RE)) out[m[1]!] = m[2]!;
  return out;
}

const block = (s: DocSection) => `${begin(s.id)}\n## ${s.title}\n\n${s.body.trim()}\n${end(s.id)}`;
const blockBody = (s: DocSection) => `## ${s.title}\n\n${s.body.trim()}`;

/** Which sections differ from what's on disk. */
export function changedSections(existing: string | null, sections: DocSection[]): Set<string> {
  const blocks = existing ? readBlocks(existing) : {};
  return new Set(sections.filter((s) => blocks[s.id]?.trim() !== blockBody(s).trim()).map((s) => s.id));
}

/**
 * The doc with `only` sections regenerated (all when omitted). Blocks that exist are replaced in
 * place; new ones are appended; everything outside the markers is kept as written.
 */
export function mergeDoc(id: DocFileId, existing: string | null, sections: DocSection[], only?: string[]): string {
  const want = only ? sections.filter((s) => only.includes(s.id)) : sections;
  if (!existing?.trim()) return `${HEADERS[id]}\n\n${sections.map(block).join('\n\n')}\n`;
  let text = existing;
  const have = readBlocks(existing);
  for (const s of want) {
    if (s.id in have) {
      const re = new RegExp(`${escapeRe(begin(s.id))}\\n?[\\s\\S]*?\\n?${escapeRe(end(s.id))}`);
      text = text.replace(re, () => block(s));
    } else text = `${text.replace(/\s*$/, '')}\n\n${block(s)}\n`;
  }
  return text.endsWith('\n') ? text : text + '\n';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
  a?: number;
  b?: number;
}

/** Line diff (LCS) with `context` unchanged lines around each change; long equal runs become a gap. */
export function diffLines(oldText: string, newText: string, context = 3): DiffLine[] {
  const a = oldText ? oldText.replace(/\n$/, '').split('\n') : [];
  const b = newText ? newText.replace(/\n$/, '').split('\n') : [];
  // Trim the common head and tail so the table stays small.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);
  const full: DiffLine[] = [];
  for (let i = 0; i < head; i++) full.push({ kind: 'same', text: a[i]!, a: i + 1, b: i + 1 });
  if (A.length * B.length > 4_000_000) {
    A.forEach((t, i) => full.push({ kind: 'del', text: t, a: head + i + 1 }));
    B.forEach((t, i) => full.push({ kind: 'add', text: t, b: head + i + 1 }));
  } else {
    const n = A.length;
    const m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) {
        full.push({ kind: 'same', text: A[i]!, a: head + i + 1, b: head + j + 1 });
        i++;
        j++;
      } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
        // Removed lines first, then their replacement, like a unified diff.
        full.push({ kind: 'del', text: A[i]!, a: head + i + 1 });
        i++;
      } else {
        full.push({ kind: 'add', text: B[j]!, b: head + j + 1 });
        j++;
      }
    }
  }
  for (let k = 0; k < tail; k++) full.push({ kind: 'same', text: a[a.length - tail + k]!, a: a.length - tail + k + 1, b: b.length - tail + k + 1 });
  if (!full.some((l) => l.kind !== 'same')) return [];
  const keep = new Array<boolean>(full.length).fill(false);
  full.forEach((l, idx) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(full.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let gap = 0;
  full.forEach((l, idx) => {
    if (keep[idx]) {
      if (gap) out.push({ kind: 'gap', text: `${gap} unchanged line${gap === 1 ? '' : 's'}` });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ kind: 'gap', text: `${gap} unchanged line${gap === 1 ? '' : 's'}` });
  return out;
}
