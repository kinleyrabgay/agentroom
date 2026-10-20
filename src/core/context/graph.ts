import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractFile } from './extract.js';
import { buildModules, partitionModules } from './modules.js';
import { buildResolveContext, mapTests, resolveImports } from './resolve.js';
import { isIndexablePath, readIndexable, scanFiles } from './scan.js';
import type { ContextGraph, FileNode } from './types.js';

export const GRAPH_VERSION = 1 as const;

/** Where the context lives: shared cards + index (committed) and the local fact graph. */
export function contextPaths(root: string) {
  const agentroom = path.join(path.resolve(root), '.agentroom');
  const dir = path.join(agentroom, 'context');
  const runsDir = path.join(agentroom, 'runs', 'context');
  return {
    dir,
    index: path.join(dir, 'INDEX.md'),
    modules: path.join(dir, 'modules'),
    card: (id: string) => path.join(dir, 'modules', `${id}.md`),
    runsDir,
    graph: path.join(runsDir, 'graph.json'),
  };
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  } catch {
    return null;
  }
}

export function headSha(root: string): string | null {
  return git(root, ['rev-parse', 'HEAD'])?.trim() || null;
}

/**
 * Files that may differ from `sha`: committed and uncommitted changes since then, plus untracked files.
 * Null when `sha` is unknown here (rewritten history, not a repo): callers do a full build.
 */
export function changedSince(root: string, sha: string | null): string[] | null {
  if (!sha || git(root, ['cat-file', '-e', `${sha}^{commit}`]) === null) return null;
  const diff = git(root, ['diff', '--name-only', '--no-renames', '-z', sha]);
  const untracked = git(root, ['ls-files', '-o', '--exclude-standard', '-z']);
  if (diff === null) return null;
  return [...new Set([...diff.split('\0'), ...(untracked ?? '').split('\0')].filter(Boolean))].sort();
}

function toNode(rel: string, content: string): FileNode {
  const e = extractFile(rel, content);
  return { path: rel, ...e, imports: [], importNames: {}, external: [], testsFor: [] };
}

/** Resolution, test mapping and modules over the whole file set: shared by full and incremental builds. */
function assemble(root: string, nodes: Record<string, FileNode>, prev: ContextGraph | null | undefined, dirty: string[]): ContextGraph {
  const sorted: Record<string, FileNode> = {};
  for (const k of Object.keys(nodes).sort()) sorted[k] = nodes[k]!;
  const ctx = buildResolveContext(sorted, (rel) => readIndexable(root, rel));
  for (const [file, node] of Object.entries(sorted)) Object.assign(node, resolveImports(file, node, ctx));
  mapTests(sorted, ctx);
  const parts = partitionModules(Object.keys(sorted), ctx.packages, prev?.modules);
  const { modules, fileModule, edges } = buildModules(sorted, parts, prev?.modules);
  return {
    version: GRAPH_VERSION,
    indexedSha: headSha(root),
    indexedAt: new Date().toISOString(),
    dirty: [...dirty].sort(),
    files: sorted,
    modules,
    fileModule,
    edges,
    packages: ctx.packages,
  };
}

function dirtyNow(root: string, files: Record<string, FileNode>): string[] {
  const changed = changedSince(root, headSha(root)) ?? [];
  return changed.filter((f) => files[f]);
}

/** Index the whole repo. `prev` keeps module ids stable. */
export function buildGraph(root: string, opts: { prev?: ContextGraph | null } = {}): ContextGraph {
  const nodes: Record<string, FileNode> = {};
  for (const rel of scanFiles(root)) {
    const content = readIndexable(root, rel);
    if (content !== null) nodes[rel] = toNode(rel, content);
  }
  return assemble(root, nodes, opts.prev, dirtyNow(root, nodes));
}

/** Re-index only `changed` paths (added, modified or deleted); everything else is reused from `prev`. */
export function updateGraph(root: string, prev: ContextGraph, changed: string[]): ContextGraph {
  const nodes: Record<string, FileNode> = {};
  for (const [k, v] of Object.entries(prev.files)) nodes[k] = { ...v, imports: [], importNames: {}, external: [], testsFor: [] };
  const touched = new Set([...changed, ...prev.dirty].map((f) => f.split(path.sep).join('/')));
  for (const rel of touched) {
    delete nodes[rel];
    if (!isIndexablePath(rel)) continue;
    // Respect .gitignore for files we haven't seen before.
    if (!prev.files[rel] && git(root, ['check-ignore', '-q', rel]) !== null) continue;
    const content = readIndexable(root, rel);
    if (content !== null) nodes[rel] = toNode(rel, content);
  }
  return assemble(root, nodes, prev, dirtyNow(root, nodes));
}

export function loadGraph(root: string): ContextGraph | null {
  try {
    const g = JSON.parse(fs.readFileSync(contextPaths(root).graph, 'utf8')) as ContextGraph;
    return g.version === GRAPH_VERSION ? g : null;
  } catch {
    return null;
  }
}

export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function saveGraph(root: string, graph: ContextGraph): void {
  writeFileAtomic(contextPaths(root).graph, JSON.stringify(graph));
}
