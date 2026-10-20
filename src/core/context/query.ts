import fs from 'node:fs';
import path from 'node:path';
import { listCardIds, loadCard, renderCitation, staleness } from './cards.js';
import { contextPaths, loadGraph } from './graph.js';
import { renderIndex } from './index-md.js';
import type { ContextGraph, ModuleCard, ModuleNode } from './types.js';

export type DepsDirection = 'up' | 'down';

/** Splits `buildGraph`, `build_graph`, `src/core/graph.ts` into lowercase terms. */
export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** One search result, structured (the UI) or rendered as a line (bots). */
export interface ContextHit {
  kind: 'symbol' | 'file' | 'module';
  /** Module id for modules; the file path otherwise. */
  path: string;
  line?: number;
  name?: string;
  /** Owning module. */
  moduleId: string;
  /** Signature, line count or card purpose. */
  detail: string;
  score: number;
}

interface Doc {
  kind: 'symbol' | 'file' | 'module';
  key: string;
  hit: Omit<ContextHit, 'score'>;
  terms: string[];
  /** Exact name for symbol docs (boosted on exact match). */
  name?: string;
  render: () => string;
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Read side of the context, written for bots: every answer is compact text with `path:line` pointers.
 * Reloads the graph and cards from disk when they change.
 */
export class ContextReader {
  private graph: ContextGraph | null = null;
  private graphMtime = 0;
  private cards = new Map<string, { card: ModuleCard | null; mtime: number }>();
  private docs: Doc[] | null = null;
  private df = new Map<string, number>();

  constructor(
    private readonly root: string,
    graph?: ContextGraph,
  ) {
    if (graph) this.graph = graph;
  }

  /** The current graph (null until `agentroom context build` has run). */
  current(): ContextGraph | null {
    const file = contextPaths(this.root).graph;
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      return this.graph;
    }
    if (mtime !== this.graphMtime) {
      const g = loadGraph(this.root);
      if (g) {
        this.graph = g;
        this.graphMtime = mtime;
        this.docs = null;
      }
    }
    return this.graph;
  }

  card(id: string): ModuleCard | null {
    const file = contextPaths(this.root).card(id);
    let mtime = -1;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      /* no card */
    }
    const hit = this.cards.get(id);
    if (hit && hit.mtime === mtime) return hit.card;
    const card = mtime < 0 ? null : loadCard(this.root, id);
    this.cards.set(id, { card, mtime });
    this.docs = null;
    return card;
  }

  private need(): ContextGraph {
    const g = this.current();
    if (!g) throw new Error('No repo context yet. Run `agentroom context build`.');
    return g;
  }

  /** INDEX.md (or a fresh render when it's missing). */
  overview(): string {
    try {
      return fs.readFileSync(contextPaths(this.root).index, 'utf8');
    } catch {
      const g = this.need();
      const purposes = Object.fromEntries(Object.keys(g.modules).map((id) => [id, this.card(id)?.purpose ?? '']));
      return renderIndex(g, purposes, { repoName: path.basename(path.resolve(this.root)) });
    }
  }

  /** A module by id, by directory, or the module that owns a file. */
  resolveModule(target: string): ModuleNode | null {
    const g = this.need();
    const t = target.trim().replace(/^\.\//, '').replace(/\/$/, '').split('#')[0]!.replace(/:\d+$/, '');
    if (g.modules[t]) return g.modules[t]!;
    const byDir = Object.values(g.modules).find((m) => m.dir === t);
    if (byDir) return byDir;
    const owner = g.fileModule[t];
    return owner ? g.modules[owner]! : null;
  }

  /** The card (with a stale warning when the code moved on), then facts: files, deps, tests. */
  module(target: string): string {
    const g = this.need();
    const mod = this.resolveModule(target);
    if (!mod) return `No module "${target}". Modules: ${Object.keys(g.modules).slice(0, 40).join(', ')}`;
    const card = this.card(mod.id);
    const out: string[] = [`# ${mod.id} — ${mod.dir || '.'}/ (${mod.files.length} files)`];
    if (card?.generatedAt) {
      const st = staleness(card, mod, g);
      if (st.stale) {
        const what = [
          st.changedFiles.length ? `changed ${st.changedFiles.slice(0, 6).join(', ')}${st.changedFiles.length > 6 ? ` +${st.changedFiles.length - 6}` : ''}` : '',
          st.surfaceChanged ? 'public surface changed' : '',
          st.brokenCites.length ? `broken refs ${st.brokenCites.slice(0, 3).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; ');
        out.push(`⚠ stale since ${card.generatedAtSha?.slice(0, 7) ?? card.generatedAt.slice(0, 10)}: ${what}. Verify against the code before relying on it.`);
      }
      out.push('', card.purpose);
      const section = (title: string, list: ModuleCard['entryPoints']) => {
        if (!list.length) return;
        out.push('', `## ${title}`);
        for (const c of list) out.push(`- ${c.text} (${c.cite.map((x) => renderCitation(g, x)).join(', ')})`);
      };
      section('Entry points', card.entryPoints);
      section('Invariants', card.invariants);
      section('Gotchas', card.gotchas);
      section('How to change', card.howToChange);
      if (card.decisions.length) out.push('', '## Decisions', ...card.decisions.slice(-8).map((d) => `- ${d}`));
    } else out.push('', 'No card yet: facts only.');
    if (card?.humanNotes.trim()) out.push('', '## Human notes (authoritative)', card.humanNotes.trim());

    out.push('', '## Files');
    for (const f of mod.files.slice(0, 60)) {
      const n = g.files[f]!;
      const syms = n.symbols.filter((s) => s.exported && s.kind !== 'method');
      const list = syms
        .slice(0, 6)
        .map((s) => `${s.name}:${s.line}`)
        .join(', ');
      out.push(`- ${f}${n.isTest ? ' (test)' : ''}${list ? ` — ${list}${syms.length > 6 ? ` +${syms.length - 6}` : ''}` : ''}`);
    }
    if (mod.files.length > 60) out.push(`- …${mod.files.length - 60} more`);
    const rel = (rec: Record<string, number>) =>
      Object.entries(rec)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, w]) => `${id}(${w})`)
        .join(', ');
    if (Object.keys(mod.deps).length) out.push('', `Depends on: ${rel(mod.deps)}`);
    if (Object.keys(mod.dependents).length) out.push(`Used by: ${rel(mod.dependents)}`);
    if (mod.tests.length) out.push(`Tests: ${mod.tests.slice(0, 10).join(', ')}${mod.tests.length > 10 ? ` +${mod.tests.length - 10}` : ''}`);
    return out.join('\n');
  }

  private index(): Doc[] {
    if (this.docs) return this.docs;
    const g = this.need();
    const docs: Doc[] = [];
    for (const [f, n] of Object.entries(g.files)) {
      const moduleId = g.fileModule[f] ?? '';
      docs.push({ kind: 'file', key: f, hit: { kind: 'file', path: f, moduleId, detail: `${n.lines} lines` }, terms: tokenize(f), render: () => `file ${f} (${n.lines} lines)` });
      for (const s of n.symbols) {
        docs.push({
          kind: 'symbol',
          key: `${f}#${s.name}:${s.line}`,
          hit: { kind: 'symbol', path: f, line: s.line, name: s.name, moduleId, detail: short(s.signature, 120) },
          name: s.name.toLowerCase(),
          terms: [...tokenize(s.name), ...tokenize(s.name), ...tokenize(s.signature), ...tokenize(f).slice(-2)],
          render: () => `${s.kind} ${s.name} ${f}:${s.line} — ${short(s.signature, 90)}`,
        });
      }
    }
    for (const m of Object.values(g.modules)) {
      const card = this.card(m.id);
      const text = card ? [card.purpose, ...[card.entryPoints, card.invariants, card.gotchas, card.howToChange].flat().map((c) => c.text), card.humanNotes].join(' ') : '';
      docs.push({
        kind: 'module',
        key: m.id,
        hit: { kind: 'module', path: m.id, moduleId: m.id, detail: card?.purpose ? short(card.purpose, 140) : `${m.dir || '.'}/ · ${m.files.length} files` },
        terms: [...tokenize(m.id), ...tokenize(m.dir), ...tokenize(text)],
        render: () => `module ${m.id} (${m.dir || '.'}/)${card?.purpose ? ` — ${short(card.purpose, 90)}` : ''}`,
      });
    }
    this.df = new Map();
    for (const d of docs) for (const t of new Set(d.terms)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs = docs;
    return docs;
  }

  /** BM25 over symbols, paths and cards, with a boost for exact names. One line per hit. */
  find(q: string, limit = 12): string {
    if (!q.trim()) return 'Empty query.';
    const scored = this.score(q);
    if (!scored.length) return `No matches for "${q}".`;
    return scored
      .slice(0, limit)
      .map((x) => x.d.render())
      .join('\n');
  }

  /** The same search, structured. */
  search(q: string, limit = 20): ContextHit[] {
    if (!q.trim()) return [];
    return this.score(q)
      .slice(0, limit)
      .map((x) => ({ ...x.d.hit, score: Math.round(x.s * 100) / 100 }));
  }

  private score(q: string): { d: Doc; s: number }[] {
    const docs = this.index();
    const terms = tokenize(q);
    const exact = q.trim().toLowerCase();
    const N = docs.length;
    const avg = docs.reduce((s, d) => s + d.terms.length, 0) / Math.max(1, N);
    const k1 = 1.2;
    const b = 0.75;
    const scored: { d: Doc; s: number }[] = [];
    for (const d of docs) {
      let s = 0;
      for (const t of terms) {
        let tf = 0;
        for (const x of d.terms) if (x === t) tf++;
        if (!tf) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        s += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.terms.length) / avg));
      }
      if (d.name && d.name === exact) s += 10;
      else if (d.name && exact.length > 2 && d.name.startsWith(exact)) s += 3;
      if (d.kind === 'file' && d.key.toLowerCase().includes(exact) && exact.length > 2) s += 4;
      if (s > 0) scored.push({ d, s: s * (d.kind === 'module' ? 1.2 : 1) });
    }
    scored.sort((a, b) => b.s - a.s || a.d.key.localeCompare(b.d.key));
    return scored;
  }

  /** File-level graph: target file(s) from a file, `file#symbol`, a symbol name or a module id. */
  private targetFiles(target: string): string[] {
    const g = this.need();
    const t = target.trim().replace(/^\.\//, '');
    const file = t.split('#')[0]!.replace(/:\d+$/, '');
    if (g.files[file]) return [file];
    if (g.modules[t]) return g.modules[t]!.files;
    const byDir = Object.values(g.modules).find((m) => m.dir === t.replace(/\/$/, ''));
    if (byDir) return byDir.files;
    const named = Object.values(g.files)
      .filter((n) => n.symbols.some((s) => s.name === t && s.exported))
      .map((n) => n.path);
    return named.slice(0, 5);
  }

  private reverse(): Map<string, string[]> {
    const g = this.need();
    const rev = new Map<string, string[]>();
    for (const [f, n] of Object.entries(g.files)) for (const t of n.imports) rev.set(t, [...(rev.get(t) ?? []), f]);
    return rev;
  }

  /**
   * `down`: what the target uses (its dependencies). `up`: what uses the target (its dependents).
   * Module ids work at module level; files and symbols at file level.
   */
  deps(target: string, direction: DepsDirection = 'down', depth = 2): string {
    const g = this.need();
    const d = Math.max(1, Math.min(depth, 5));
    const verb = direction === 'down' ? 'uses' : 'is used by';
    if (g.modules[target]) {
      const out = [`${target} ${verb}:`];
      const seen = new Set([target]);
      const walk = (id: string, level: number) => {
        const rec = direction === 'down' ? g.modules[id]!.deps : g.modules[id]!.dependents;
        for (const [next, w] of Object.entries(rec).sort((a, b) => b[1] - a[1])) {
          if (seen.has(next)) continue;
          seen.add(next);
          out.push(`${'  '.repeat(level)}- ${next} (${w})`);
          if (level < d && out.length < 60) walk(next, level + 1);
        }
      };
      walk(target, 1);
      return out.length > 1 ? out.join('\n') : `${target}: none.`;
    }
    const start = this.targetFiles(target);
    if (!start.length) return `Nothing matches "${target}".`;
    const rev = direction === 'up' ? this.reverse() : null;
    const next = (f: string) => (direction === 'down' ? g.files[f]?.imports ?? [] : rev!.get(f) ?? []);
    const out = [`${start.length === 1 ? start[0] : `${target} (${start.length} files)`} ${verb}:`];
    const seen = new Set(start);
    const walk = (f: string, level: number) => {
      for (const n of [...next(f)].sort()) {
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(`${'  '.repeat(level)}- ${n} [${g.fileModule[n] ?? '?'}]`);
        if (level < d && out.length < 60) walk(n, level + 1);
      }
    };
    for (const f of start) walk(f, 1);
    if (out.length >= 60) out.push('…truncated');
    return out.length > 1 ? out.join('\n') : `${out[0]} nothing in the repo.`;
  }

  /** Blast radius of changing `files`: everything that transitively imports them, grouped by module, plus tests to run. */
  impactSet(files: string[]): { files: string[]; modules: string[]; tests: string[] } {
    const g = this.need();
    const rev = this.reverse();
    const start = files.map((f) => f.replace(/^\.\//, '')).filter((f) => g.files[f]);
    const seen = new Set(start);
    const queue = start.map((f) => ({ f, level: 0 }));
    while (queue.length) {
      const { f, level } = queue.shift()!;
      if (level >= 6) continue;
      for (const n of rev.get(f) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push({ f: n, level: level + 1 });
      }
    }
    const affected = [...seen].filter((f) => !start.includes(f)).sort();
    const all = new Set([...start, ...affected]);
    const tests = new Set<string>();
    for (const f of all) if (g.files[f]?.isTest) tests.add(f);
    for (const n of Object.values(g.files)) if (n.isTest && n.testsFor.some((s) => all.has(s))) tests.add(n.path);
    const modules = [...new Set([...all].map((f) => g.fileModule[f]).filter((m): m is string => !!m))].sort();
    return { files: affected.filter((f) => !g.files[f]!.isTest), modules, tests: [...tests].sort() };
  }

  impact(files: string[]): string {
    const g = this.need();
    const known = files.map((f) => f.replace(/^\.\//, '')).filter((f) => g.files[f]);
    const unknown = files.filter((f) => !g.files[f.replace(/^\.\//, '')]);
    if (!known.length) return `None of these files are indexed: ${files.join(', ')}`;
    const r = this.impactSet(known);
    const out = [`Changed: ${known.join(', ')}`];
    if (unknown.length) out.push(`Not indexed: ${unknown.join(', ')}`);
    out.push(`Modules affected (${r.modules.length}): ${r.modules.join(', ')}`);
    out.push(`Files that depend on them (${r.files.length}):`, ...r.files.slice(0, 30).map((f) => `- ${f}`));
    if (r.files.length > 30) out.push(`- …${r.files.length - 30} more`);
    out.push(`Tests to run (${r.tests.length}):`, ...(r.tests.length ? r.tests.slice(0, 30).map((f) => `- ${f}`) : ['- none found']));
    return out.join('\n');
  }

  /** Module cards present on disk, for listing. */
  cardIds(): string[] {
    return listCardIds(this.root);
  }
}
