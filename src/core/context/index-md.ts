import path from 'node:path';
import { estimateTokens } from './cards.js';
import { contextPaths, writeFileAtomic } from './graph.js';
import type { ContextGraph, ModuleNode } from './types.js';

export const INDEX_TOKEN_BUDGET = 1500;

/** Fallback one-liner when a module has no card yet: its routes, else its most-used exports. */
export function derivedPurpose(mod: ModuleNode, graph: ContextGraph): string {
  const routes = mod.files.flatMap((f) => graph.files[f]!.symbols.filter((s) => s.kind === 'route').map((s) => s.name));
  if (routes.length) return `routes: ${routes.slice(0, 4).join(', ')}${routes.length > 4 ? ` +${routes.length - 4}` : ''}`;
  const used = new Map<string, number>();
  for (const e of mod.surface) {
    const name = e.split('#')[1];
    if (name && name !== '*' && name !== 'default') used.set(name, (used.get(name) ?? 0) + 1);
  }
  let names = [...used.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  if (!names.length) names = mod.files.flatMap((f) => graph.files[f]!.symbols.filter((s) => s.exported && s.kind !== 'method').map((s) => s.name));
  if (names.length) return `exports: ${[...new Set(names)].slice(0, 5).join(', ')}`;
  const langs = [...new Set(mod.files.map((f) => graph.files[f]!.lang))].filter((l) => l !== 'other');
  return langs.length ? `${langs.join('/')} files` : 'docs/config';
}

interface Level {
  purpose: number;
  deps: number;
}

const LEVELS: Level[] = [
  { purpose: 110, deps: 5 },
  { purpose: 70, deps: 3 },
  { purpose: 40, deps: 2 },
  { purpose: 0, deps: 0 },
];

const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** The always-loaded map of the repo: layout + one line per module. Degrades detail to stay under budget. */
export function renderIndex(graph: ContextGraph, purposes: Record<string, string>, opts: { repoName?: string; budget?: number } = {}): string {
  const budget = opts.budget ?? INDEX_TOKEN_BUDGET;
  const mods = Object.values(graph.modules).sort((a, b) => a.dir.localeCompare(b.dir));
  const fileCount = Object.keys(graph.files).length;
  // No commit sha here: INDEX.md is committed, and it should only change when the map does.
  const header = [
    `# Repo map: ${opts.repoName ?? 'repo'}`,
    `${fileCount} files in ${mods.length} modules. Read a module's card with context_module(id); search with context_find(q); check blast radius with context_impact(files). Cards point at code; read the file before editing.`,
  ];

  // Layout: top-level directories with file counts.
  const top = new Map<string, number>();
  for (const f of Object.keys(graph.files)) {
    const seg = f.includes('/') ? f.slice(0, f.indexOf('/')) + '/' : '(root files)';
    top.set(seg, (top.get(seg) ?? 0) + 1);
  }
  const layout = `Layout: ${[...top.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([d, n]) => `${d} ${n}`)
    .join(' · ')}`;

  const line = (m: ModuleNode, lv: Level) => {
    const deps = Object.entries(m.deps)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, lv.deps)
      .map(([id]) => id);
    const purpose = cut(purposes[m.id]?.trim() || derivedPurpose(m, graph), lv.purpose);
    return `- ${m.id} (${m.files.length})${m.dir && m.id !== m.dir.replace(/\//g, '-').toLowerCase() ? ` ${m.dir}/` : ''}${purpose ? ` — ${purpose}` : ''}${deps.length ? ` → ${deps.join(', ')}` : ''}`;
  };

  for (const lv of LEVELS) {
    const text = [...header, layout, '', '## Modules', ...mods.map((m) => line(m, lv))].join('\n') + '\n';
    if (estimateTokens(text) <= budget) return text;
  }
  // Huge repo: the biggest modules, the rest by count.
  const minimal = LEVELS[LEVELS.length - 1]!;
  const ranked = [...mods].sort((a, b) => b.files.length + Object.keys(b.dependents).length * 3 - (a.files.length + Object.keys(a.dependents).length * 3));
  let keep = ranked.length;
  while (keep > 1) {
    keep = Math.floor(keep * 0.8);
    const shown = new Set(ranked.slice(0, keep).map((m) => m.id));
    const text =
      [...header, layout, '', '## Modules', ...mods.filter((m) => shown.has(m.id)).map((m) => line(m, minimal)), `- …and ${mods.length - keep} smaller modules (context_find to locate)`].join('\n') + '\n';
    if (estimateTokens(text) <= budget) return text;
  }
  return [...header, layout].join('\n') + '\n';
}

export function writeIndex(root: string, graph: ContextGraph, purposes: Record<string, string>): { text: string; tokens: number } {
  const text = renderIndex(graph, purposes, { repoName: path.basename(path.resolve(root)) });
  writeFileAtomic(contextPaths(root).index, text);
  return { text, tokens: estimateTokens(text) };
}
