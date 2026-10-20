import type { ContextGraph } from '../context/types.js';
import type { CrossRepoEdge, CrossRepoEvidence, CrossRepoKind } from '../../shared/types/index.js';

/**
 * Edges between the repos of a workspace, inferred from contracts both sides can see:
 * HTTP routes (server route definitions, OpenAPI/Swagger specs) matched against path strings in
 * client code, GraphQL schema fields against operations, tRPC routers against `trpc.x.y` calls,
 * and package names one repo publishes and another imports. Deterministic, no model calls.
 *
 * Edges point consumer → provider (the frontend module that calls `/api/users` → the backend
 * module that serves it), like import edges inside a repo.
 */

export interface CrossRepoInput {
  repo: string;
  graph: ContextGraph;
  /** Repo-relative file contents (null when unreadable). */
  read: (rel: string) => string | null;
}

/** Most evidence lines kept per edge. */
export const EVIDENCE_MAX = 3;
/** Files read per repo when looking for client calls (largest repos are sampled in path order). */
export const SCAN_FILE_MAX = 4000;

const CODE_LANGS = new Set(['ts', 'js', 'python', 'go', 'rust', 'java', 'kotlin', 'dart', 'ruby', 'php', 'swift', 'csharp']);
const ASSET_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|css|scss|less|png|jpe?g|gif|svg|webp|ico|html?|json|ya?ml|md|txt|map|woff2?|ttf|mp4|mp3|pdf|zip)$/i;

// ── helpers ────────────────────────────────────────────────────────────────

/** Module that owns a file: the graph's mapping, else the module whose folder holds it. */
export function ownerOf(graph: ContextGraph, file: string): string | undefined {
  const direct = graph.fileModule[file];
  if (direct) return direct;
  let best: string | undefined;
  let bestLen = -1;
  for (const m of Object.values(graph.modules)) {
    if ((m.dir === '' || file.startsWith(m.dir + '/')) && m.dir.length > bestLen) {
      best = m.id;
      bestLen = m.dir.length;
    }
  }
  return best;
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

const PARAM = ':';

/** Route path → segments with params as `:` (`:id`, `{id}`, `[id]`, `<id>`, `*`). */
export function routeSegments(p: string): string[] {
  const clean = p.split(/[?#]/)[0]!.replace(/\/+$/, '');
  return clean
    .split('/')
    .filter(Boolean)
    .map((s) => (/^(:\w+\??|\{[^}]*\}|\[{1,2}\.{0,3}[^\]]*\]{1,2}|<[^>]*>|\*+)$/.test(s) ? PARAM : s.toLowerCase()));
}

/** A path string found in client code → segments (`${id}` → param), or null if it isn't a route-like path. */
export function clientSegments(literal: string): string[] | null {
  let p = literal.replace(/^https?:\/\/[^/]+/i, '');
  if (!p.startsWith('/') || p.startsWith('//')) return null;
  p = p.replace(/\$\{[^}]*\}/g, `${PARAM}x`).split(/[?#]/)[0]!.replace(/\/+$/, '');
  if (!p || ASSET_EXT.test(p)) return null;
  const segs = p.split('/').filter(Boolean);
  if (!segs.length) return null;
  const out: string[] = [];
  for (const s of segs) {
    if (s.includes(`${PARAM}x`) || /^:\w+$/.test(s) || /^\{\w+\}$/.test(s)) out.push(PARAM);
    else if (/^[\w\-.~%]+$/.test(s)) out.push(s.toLowerCase());
    else return null;
  }
  return out;
}

/**
 * How well a client path matches a route: 0 = no match; exact alignment beats a mount prefix
 * (`/api/users/7` vs a route `/users/:id` mounted under `/api`). Needs a literal segment in common.
 */
export function matchScore(client: string[], route: string[]): number {
  if (!route.length || client.length < route.length) return 0;
  if (!route.some((s) => s !== PARAM)) return 0;
  const maxOffset = Math.min(2, client.length - route.length);
  for (let k = 0; k <= maxOffset; k++) {
    if (client.length - k !== route.length) continue;
    let ok = true;
    for (let i = 0; i < route.length && ok; i++) {
      const r = route[i]!;
      const c = client[k + i]!;
      if (r === PARAM) continue;
      if (c === PARAM || c !== r) ok = false;
    }
    if (ok) return k === 0 ? 1 : 0.8 - k * 0.1;
  }
  return 0;
}

// ── providers ──────────────────────────────────────────────────────────────

interface HttpRoute {
  repo: string;
  module: string;
  file: string;
  label: string;
  segs: string[];
}

/** `METHOD /path` route symbols from the fact graph (Next.js pages excluded: they aren't API calls). */
function graphRoutes(input: CrossRepoInput): HttpRoute[] {
  const out: HttpRoute[] = [];
  for (const f of Object.values(input.graph.files)) {
    for (const s of f.symbols) {
      if (s.kind !== 'route') continue;
      const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY|ALL)\s+(\/\S*)$/i.exec(s.name);
      if (!m) continue;
      const module = ownerOf(input.graph, f.path);
      if (module) out.push({ repo: input.repo, module, file: f.path, label: `${m[1]!.toUpperCase()} ${m[2]}`, segs: routeSegments(m[2]!) });
    }
  }
  return out;
}

const SPEC_FILE = /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i;

/** Paths declared in an OpenAPI/Swagger document (JSON or YAML). */
export function specPaths(text: string, json: boolean): string[] {
  if (json) {
    try {
      const doc = JSON.parse(text) as { paths?: Record<string, unknown> };
      return Object.keys(doc.paths ?? {}).filter((p) => p.startsWith('/'));
    } catch {
      return [];
    }
  }
  const lines = text.split('\n');
  const out: string[] = [];
  let inPaths = false;
  let indent = -1;
  for (const line of lines) {
    if (/^paths\s*:\s*$/.test(line)) {
      inPaths = true;
      indent = -1;
      continue;
    }
    if (!inPaths) continue;
    if (/^\S/.test(line)) break;
    const m = /^(\s+)(['"]?)(\/[^'":]*)\2\s*:/.exec(line);
    if (!m) continue;
    if (indent < 0) indent = m[1]!.length;
    if (m[1]!.length === indent) out.push(m[3]!.trim());
  }
  return out;
}

function specRoutes(input: CrossRepoInput): HttpRoute[] {
  const out: HttpRoute[] = [];
  for (const file of Object.keys(input.graph.files)) {
    if (!SPEC_FILE.test(file)) continue;
    const text = input.read(file);
    if (!text) continue;
    const module = ownerOf(input.graph, file);
    if (!module) continue;
    for (const p of specPaths(text, file.toLowerCase().endsWith('.json'))) out.push({ repo: input.repo, module, file, label: `openapi ${p}`, segs: routeSegments(p) });
  }
  return out;
}

/** Field names under `type Query/Mutation/Subscription { … }` (incl. `extend type`). */
export function graphqlFields(sdl: string): string[] {
  const out = new Set<string>();
  for (const block of sdl.matchAll(/\b(?:extend\s+)?type\s+(Query|Mutation|Subscription)\s*(?:@\w+\s*)*\{([^}]*)\}/g)) {
    for (const f of block[2]!.matchAll(/^\s*(\w+)\s*[(:]/gm)) out.add(f[1]!);
  }
  return [...out];
}

/** Top-level fields selected by GraphQL operations in client code. */
export function graphqlOperations(text: string): { field: string; index: number }[] {
  const out: { field: string; index: number }[] = [];
  for (const m of text.matchAll(/\b(query|mutation|subscription)\b\s*\w*\s*(\([^)]*\))?\s*\{\s*(\w+)/g)) out.push({ field: m[3]!, index: m.index! });
  return out;
}

/** tRPC: procedure and sub-router keys declared in router objects. */
export function trpcKeys(text: string): string[] {
  if (!/\b(createTRPCRouter|router)\s*\(/.test(text) || !/procedure/i.test(text)) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/(\w+)\s*:\s*(?:\w+\.)?(?:\w*[Pp]rocedure|\w*[Rr]outer)\b/g)) out.add(m[1]!);
  return [...out];
}

/** tRPC calls in client code: `trpc.users.byId.useQuery(…)`, `api.post.create.mutate(…)`. */
export function trpcCalls(text: string): { keys: string[]; index: number }[] {
  if (!/trpc/i.test(text)) return [];
  const out: { keys: string[]; index: number }[] = [];
  for (const m of text.matchAll(/\b(?:trpc|api|client)\.(\w+)(?:\.(\w+))?\.(?:useQuery|useMutation|useInfiniteQuery|useSuspenseQuery|query|mutate|subscribe)\b/g)) {
    out.push({ keys: [m[1]!, ...(m[2] ? [m[2]] : [])], index: m.index! });
  }
  return out;
}

/** Package names a repo publishes: package.json / go.mod / pubspec.yaml in its package folders. */
export function publishedPackages(input: CrossRepoInput): { name: string; module: string; file: string }[] {
  const out: { name: string; module: string; file: string }[] = [];
  const dirs = input.graph.packages.length ? input.graph.packages : [''];
  for (const dir of dirs) {
    const at = (f: string) => (dir ? `${dir}/${f}` : f);
    const add = (name: string | undefined, file: string) => {
      if (!name) return;
      const module = ownerOf(input.graph, file) ?? ownerOf(input.graph, at('index.ts'));
      if (module) out.push({ name, module, file });
    };
    const pkg = input.read(at('package.json'));
    if (pkg) {
      try {
        const j = JSON.parse(pkg) as { name?: string; private?: boolean };
        if (typeof j.name === 'string') add(j.name, at('package.json'));
      } catch {
        /* not JSON */
      }
    }
    const gomod = input.read(at('go.mod'));
    if (gomod) add(/^module\s+(\S+)/m.exec(gomod)?.[1], at('go.mod'));
    const pub = input.read(at('pubspec.yaml'));
    if (pub) add(/^name\s*:\s*([\w-]+)/m.exec(pub)?.[1], at('pubspec.yaml'));
  }
  return out;
}

// ── client side ───────────────────────────────────────────────────────────

const IMPORT_LINE = /^\s*(import|export)\b.*\bfrom\b|^\s*import\s+['"]|\brequire\s*\(|^\s*#\s*include|^\s*using\s/;

/** Path-like string literals in code (single, double and template quotes), with their offsets. */
export function pathLiterals(text: string): { value: string; index: number }[] {
  const out: { value: string; index: number }[] = [];
  const re = /(['"])((?:https?:\/\/[^'"\s/]+)?\/[^'"\s]*)\1|`((?:https?:\/\/[^`\s/]+|\$\{[^}`]*\})?\/[^`\s]*)`/g;
  for (const m of text.matchAll(re)) {
    const value = m[2] ?? m[3];
    if (!value) continue;
    const lineStart = text.lastIndexOf('\n', m.index!) + 1;
    const lineEnd = text.indexOf('\n', m.index!);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (IMPORT_LINE.test(line)) continue;
    // `${base}/users` → treat the base as an origin.
    out.push({ value: value.replace(/^\$\{[^}]*\}(?=\/)/, ''), index: m.index! });
  }
  return out;
}

// ── inference ─────────────────────────────────────────────────────────────

class EdgeSet {
  private edges = new Map<string, CrossRepoEdge>();

  add(fromRepo: string, from: string, toRepo: string, to: string, kind: CrossRepoKind, ev: CrossRepoEvidence) {
    if (fromRepo === toRepo) return;
    const key = `${fromRepo}\u0000${from}\u0000${toRepo}\u0000${to}\u0000${kind}`;
    const e = this.edges.get(key) ?? { fromRepo, from, toRepo, to, kind, weight: 0, evidence: [] };
    e.weight++;
    if (e.evidence.length < EVIDENCE_MAX && !e.evidence.some((x) => x.file === ev.file && x.detail === ev.detail)) e.evidence.push(ev);
    this.edges.set(key, e);
  }

  list(): CrossRepoEdge[] {
    return [...this.edges.values()].sort((a, b) => b.weight - a.weight || a.fromRepo.localeCompare(b.fromRepo) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }
}

/** Every cross-repo edge in a workspace. */
export function inferCrossRepoEdges(inputs: CrossRepoInput[]): CrossRepoEdge[] {
  if (inputs.length < 2) return [];
  const edges = new EdgeSet();

  const routes = inputs.flatMap((i) => [...graphRoutes(i), ...specRoutes(i)]);
  const gqlFields = new Map<string, { repo: string; module: string }[]>();
  const trpc = new Map<string, { repo: string; module: string }[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);

  // Providers that need file contents (GraphQL schemas, tRPC routers) are found in the same pass as clients.
  const texts = new Map<string, Map<string, string>>();
  for (const input of inputs) {
    const files = new Map<string, string>();
    const candidates = Object.values(input.graph.files)
      .filter((f) => !f.isTest && (CODE_LANGS.has(f.lang) || /\.(graphql|gql)$/i.test(f.path)))
      .map((f) => f.path)
      .sort()
      .slice(0, SCAN_FILE_MAX);
    for (const rel of candidates) {
      const text = input.read(rel);
      if (!text) continue;
      files.set(rel, text);
      const module = ownerOf(input.graph, rel);
      if (!module) continue;
      const sdl = /\.(graphql|gql)$/i.test(rel) ? text : /\btype\s+(Query|Mutation)\s*\{/.test(text) ? text : '';
      if (sdl) for (const f of graphqlFields(sdl)) push(gqlFields, f, { repo: input.repo, module });
      for (const k of trpcKeys(text)) push(trpc, k, { repo: input.repo, module });
    }
    texts.set(input.repo, files);
  }

  for (const input of inputs) {
    const files = texts.get(input.repo)!;
    for (const [rel, text] of files) {
      const from = ownerOf(input.graph, rel);
      if (!from) continue;

      // HTTP: path strings → best matching routes in other repos.
      if (routes.length) {
        for (const lit of pathLiterals(text)) {
          const segs = clientSegments(lit.value);
          if (!segs) continue;
          // Best match among code routes and, separately, among specs: an exact OpenAPI path
          // shouldn't hide the code that serves it (often mounted under a prefix like /api).
          const best = { code: 0, spec: 0 };
          const hits: Record<'code' | 'spec', HttpRoute[]> = { code: [], spec: [] };
          for (const r of routes) {
            if (r.repo === input.repo) continue;
            const s = matchScore(segs, r.segs);
            if (!s) continue;
            const k = r.label.startsWith('openapi ') ? 'spec' : 'code';
            if (s > best[k]) {
              best[k] = s;
              hits[k] = [r];
            } else if (s === best[k]) hits[k].push(r);
          }
          for (const r of [...hits.code, ...hits.spec]) {
            const kind: CrossRepoKind = r.label.startsWith('openapi ') ? 'openapi' : 'http';
            edges.add(input.repo, from, r.repo, r.module, kind, { file: rel, line: lineAt(text, lit.index), detail: `${lit.value} → ${r.label.replace(/^openapi /, '')}` });
          }
        }
      }

      // GraphQL operations → schema fields in other repos.
      if (gqlFields.size && /\b(gql|graphql)\b|\.(graphql|gql)$/i.test(text + rel)) {
        for (const op of graphqlOperations(text)) {
          for (const p of gqlFields.get(op.field) ?? []) edges.add(input.repo, from, p.repo, p.module, 'graphql', { file: rel, line: lineAt(text, op.index), detail: op.field });
        }
      }

      // tRPC calls → routers in other repos (every key in the call must be known there).
      if (trpc.size) {
        for (const call of trpcCalls(text)) {
          const providers = call.keys.map((k) => new Set((trpc.get(k) ?? []).map((p) => `${p.repo}\u0000${p.module}`)));
          const common = [...providers[0]!].filter((k) => providers.every((s) => s.has(k)));
          for (const key of common) {
            const [repo, module] = key.split('\u0000') as [string, string];
            edges.add(input.repo, from, repo, module, 'trpc', { file: rel, line: lineAt(text, call.index), detail: call.keys.join('.') });
          }
        }
      }
    }
  }

  // Packages: a repo imports a package another repo publishes.
  const published = inputs.flatMap((i) => publishedPackages(i).map((p) => ({ ...p, repo: i.repo })));
  if (published.length) {
    for (const input of inputs) {
      for (const f of Object.values(input.graph.files)) {
        if (!f.external.length) continue;
        const from = ownerOf(input.graph, f.path);
        if (!from) continue;
        for (const ext of f.external) {
          const p = published.find((x) => x.repo !== input.repo && (ext === x.name || ext.startsWith(x.name + '/')));
          if (p) edges.add(input.repo, from, p.repo, p.module, 'package', { file: f.path, detail: ext });
        }
      }
    }
  }

  return edges.list();
}
