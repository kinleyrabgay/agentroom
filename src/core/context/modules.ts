import { sha1 } from './extract.js';
import type { FileNode, ModuleEdge, ModuleNode } from './types.js';

/** A module aims for this many files; bigger directories split by subdirectory. */
export const MODULE_MAX = 40;
/** Smaller directories fold into their parent. */
export const MODULE_MIN = 3;
/** A kept module beyond this size is re-partitioned even when it existed before. */
export const MODULE_HARD_MAX = 80;

export interface Part {
  dir: string;
  files: string[];
}

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const isUnder = (file: string, dir: string) => dir === '' || file.startsWith(dir + '/');
const depth = (dir: string) => (dir === '' ? 0 : dir.split('/').length);

/** Deepest package root containing the path. */
function ownerPackage(file: string, packages: string[]): string {
  let best = '';
  for (const p of packages) if (isUnder(file, p) && depth(p) >= depth(best) && p.length >= best.length) best = p;
  return best;
}

/**
 * Deterministic directory partition. Package roots are hard boundaries; a directory with ≤ MODULE_MAX files
 * (its whole subtree) is one module; bigger ones split by subdirectory; tiny leftovers fold into the parent.
 * With `prev`, existing modules are kept while they still make sense, so ids stay stable as files come and go.
 */
export function partitionModules(files: string[], packages: string[], prev?: Record<string, ModuleNode> | null): Part[] {
  const pkgs = [...new Set(['', ...packages])].sort();
  const owner = new Map(files.map((f) => [f, ownerPackage(f, pkgs)]));
  const out = new Map<string, Set<string>>();
  const put = (dir: string, fs: string[]) => {
    const s = out.get(dir) ?? new Set<string>();
    fs.forEach((f) => s.add(f));
    out.set(dir, s);
  };

  let leftover = files;
  if (prev && Object.keys(prev).length) {
    const prevDirs = Object.values(prev)
      .map((m) => m.dir)
      .sort((a, b) => depth(b) - depth(a) || b.length - a.length);
    const kept = new Map<string, string[]>();
    leftover = [];
    for (const f of files) {
      const pkg = owner.get(f)!;
      const dir = prevDirs.find((d) => isUnder(f, d) && isUnder(d, pkg) && (d !== '' || pkg === ''));
      if (dir === undefined) leftover.push(f);
      else kept.set(dir, [...(kept.get(dir) ?? []), f]);
    }
    for (const [dir, fs] of kept) {
      // A package root that appeared inside a kept module takes its files back.
      const nested = pkgs.some((p) => p !== dir && p !== '' && isUnder(p, dir) && fs.some((f) => owner.get(f) === p));
      if (fs.length > MODULE_HARD_MAX || nested) leftover.push(...fs);
      else put(dir, fs);
    }
  }

  const byPkg = new Map<string, string[]>();
  for (const f of leftover) byPkg.set(owner.get(f)!, [...(byPkg.get(owner.get(f)!) ?? []), f]);
  for (const [pkg, fs] of byPkg) for (const part of partitionTree(pkg, fs)) put(part.dir, part.files);

  return [...out.entries()].map(([dir, s]) => ({ dir, files: [...s].sort() })).sort((a, b) => a.dir.localeCompare(b.dir));
}

function partitionTree(rootDir: string, files: string[]): Part[] {
  const direct = new Map<string, string[]>();
  const children = new Map<string, Set<string>>();
  const count = new Map<string, number>();
  for (const f of files) {
    const d = dirOf(f);
    direct.set(d, [...(direct.get(d) ?? []), f]);
    // Register every directory between the file and the package root.
    let cur = d;
    while (true) {
      count.set(cur, (count.get(cur) ?? 0) + 1);
      if (cur === rootDir || cur === '') break;
      const parent = dirOf(cur);
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent)!.add(cur);
      cur = parent;
    }
  }
  const subtree = (dir: string): string[] => [...(direct.get(dir) ?? []), ...[...(children.get(dir) ?? [])].flatMap(subtree)];

  const visit = (dir: string): { parts: Part[]; loose: string[] } => {
    const n = count.get(dir) ?? 0;
    const boundary = dir === rootDir;
    if (n <= MODULE_MAX) {
      const all = subtree(dir);
      if (n >= MODULE_MIN || boundary) return { parts: all.length ? [{ dir, files: all }] : [], loose: [] };
      return { parts: [], loose: all };
    }
    const parts: Part[] = [];
    const loose = [...(direct.get(dir) ?? [])];
    for (const child of [...(children.get(dir) ?? [])].sort()) {
      const r = visit(child);
      parts.push(...r.parts);
      loose.push(...r.loose);
    }
    if (!loose.length) return { parts, loose: [] };
    if (loose.length < MODULE_MIN && !boundary) return { parts, loose };
    return { parts: [...parts, { dir, files: loose }], loose: [] };
  };
  return visit(rootDir).parts;
}

/** `src/server/automation` → `src-server-automation`; the root is `root`. Collisions keep the earlier owner's id. */
export function moduleIds(dirs: string[], prev?: Record<string, ModuleNode> | null): Map<string, string> {
  const slug = (d: string) => d.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
  const ids = new Map<string, string>();
  const taken = new Map<string, string>();
  const prevByDir = new Map(Object.values(prev ?? {}).map((m) => [m.dir, m.id]));
  // Previous owners claim their ids first so a new colliding directory never renames an old module.
  const order = [...dirs].sort((a, b) => Number(prevByDir.get(b) === slug(b)) - Number(prevByDir.get(a) === slug(a)) || a.localeCompare(b));
  for (const d of order) {
    let id = slug(d);
    if (taken.has(id) && taken.get(id) !== d) id = `${id}-${sha1(d).slice(0, 4)}`;
    taken.set(id, d);
    ids.set(d, id);
  }
  return ids;
}

/** Signature text for `file#name` surfaces, so a changed signature changes the module's surfaceHash. */
function surfaceSignature(entry: string, nodes: Record<string, FileNode>): string {
  const hash = entry.indexOf('#');
  if (hash < 0) return '';
  const node = nodes[entry.slice(0, hash)];
  const name = entry.slice(hash + 1);
  if (!node) return '';
  if (name === '*') return node.symbols.filter((s) => s.exported).map((s) => s.signature).join('\n');
  if (name === 'default') return node.symbols.find((s) => /^export\s+default\b/.test(s.signature))?.signature ?? '';
  return node.symbols.find((s) => s.name === name && s.exported)?.signature ?? node.symbols.find((s) => s.name === name)?.signature ?? '';
}

export function buildModules(
  nodes: Record<string, FileNode>,
  parts: Part[],
  prev?: Record<string, ModuleNode> | null,
): { modules: Record<string, ModuleNode>; fileModule: Record<string, string>; edges: ModuleEdge[] } {
  const ids = moduleIds(
    parts.map((p) => p.dir),
    prev,
  );
  const modules: Record<string, ModuleNode> = {};
  const fileModule: Record<string, string> = {};
  for (const p of parts) {
    const id = ids.get(p.dir)!;
    modules[id] = { id, dir: p.dir, files: p.files, tests: [], surface: [], surfaceHash: '', contentHash: '', deps: {}, dependents: {} };
    for (const f of p.files) fileModule[f] = id;
  }

  const surface = new Map<string, Set<string>>();
  const weights = new Map<string, number>();
  for (const [file, node] of Object.entries(nodes)) {
    const from = fileModule[file];
    if (!from) continue;
    const seenModules = new Set<string>();
    for (const target of node.imports) {
      const to = fileModule[target];
      if (!to || to === from) continue;
      const names = node.importNames[target] ?? [];
      const s = surface.get(to) ?? new Set<string>();
      if (names.length) names.forEach((n) => s.add(`${target}#${n}`));
      else s.add(target);
      surface.set(to, s);
      const k = `${from}\u0000${to}`;
      weights.set(k, (weights.get(k) ?? 0) + 1);
      seenModules.add(to);
    }
    if (node.isTest) {
      for (const src of node.testsFor) {
        const m = fileModule[src];
        if (m) modules[m]!.tests.push(file);
      }
    }
  }

  const edges: ModuleEdge[] = [];
  for (const [k, weight] of [...weights.entries()].sort()) {
    const [from, to] = k.split('\u0000') as [string, string];
    edges.push({ from, to, weight });
    modules[from]!.deps[to] = weight;
    modules[to]!.dependents[from] = weight;
  }

  for (const m of Object.values(modules)) {
    m.surface = [...(surface.get(m.id) ?? [])].sort();
    m.surfaceHash = sha1(m.surface.map((e) => `${e}\n${surfaceSignature(e, nodes)}`).join('\n')).slice(0, 16);
    m.contentHash = sha1(m.files.map((f) => `${f}:${nodes[f]?.hash ?? ''}`).join('\n')).slice(0, 16);
    const ownTests = m.files.filter((f) => nodes[f]?.isTest && !nodes[f]!.testsFor.length);
    m.tests = [...new Set([...m.tests, ...ownTests])].sort();
  }
  return { modules, fileModule, edges };
}
