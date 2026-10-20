import path from 'node:path';
import { maskSource } from './lexer.js';
import type { FileNode, RawImport } from './types.js';
import { baseName, isTestPath, testBaseName } from './extract.js';

/** Manifests that make a directory a package (a hard module boundary). */
export const MANIFESTS = new Set([
  'package.json',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'pubspec.yaml',
  'composer.json',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'Package.swift',
  'Gemfile',
]);

interface TsConfig {
  dir: string;
  baseDir: string | null;
  paths: { prefix: string; suffix: string; wildcard: boolean; targets: string[] }[];
}

/** Everything resolution needs to know about the repo: the file set and its configs. */
export interface ResolveContext {
  files: Set<string>;
  dirFiles: Map<string, string[]>;
  tsconfigs: TsConfig[];
  workspaces: Map<string, string>;
  goModules: { dir: string; module: string }[];
  dartPackages: Map<string, string>;
  psr4: { prefix: string; dir: string }[];
  namespaces: Map<string, string[]>;
  byBase: Map<string, string[]>;
  packages: string[];
  symbolsOf: (file: string) => Set<string>;
}

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json'];

function parseJsonc(text: string): Record<string, unknown> | null {
  try {
    const stripped = maskSource(text, 'js', false).replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const join = (...parts: string[]) => {
  const p = path.posix.normalize(parts.filter((x) => x !== '').join('/') || '.');
  return p === '.' ? '' : p.replace(/\/$/, '');
};
const isUnder = (file: string, dir: string) => dir === '' || file === dir || file.startsWith(dir + '/');

export function buildResolveContext(nodes: Record<string, FileNode>, read: (rel: string) => string | null): ResolveContext {
  const files = new Set(Object.keys(nodes));
  const dirFiles = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  const namespaces = new Map<string, string[]>();
  const packages = new Set<string>();
  for (const f of [...files].sort()) {
    const d = dirOf(f);
    dirFiles.set(d, [...(dirFiles.get(d) ?? []), f]);
    if (MANIFESTS.has(path.posix.basename(f)) || /\.csproj$/.test(f)) packages.add(d);
    const node = nodes[f]!;
    if (node.lang !== 'other' && !node.isTest) {
      const b = baseName(f);
      byBase.set(b, [...(byBase.get(b) ?? []), f]);
    }
    if (node.namespace) namespaces.set(node.namespace, [...(namespaces.get(node.namespace) ?? []), f]);
  }

  const readJson = (rel: string) => {
    const t = read(rel);
    return t === null ? null : parseJsonc(t);
  };

  const tsconfigs: TsConfig[] = [];
  for (const f of files) {
    const b = path.posix.basename(f);
    if (b !== 'tsconfig.json' && b !== 'jsconfig.json') continue;
    const cfg = loadTsConfig(f, readJson, files);
    if (cfg) tsconfigs.push(cfg);
  }
  tsconfigs.sort((a, b) => b.dir.length - a.dir.length);

  const workspaces = new Map<string, string>();
  const goModules: { dir: string; module: string }[] = [];
  const dartPackages = new Map<string, string>();
  const psr4: { prefix: string; dir: string }[] = [];
  for (const f of files) {
    const b = path.posix.basename(f);
    const d = dirOf(f);
    if (b === 'package.json') {
      const name = readJson(f)?.name;
      if (typeof name === 'string' && name) workspaces.set(name, d);
    } else if (b === 'go.mod') {
      const mod = read(f)?.match(/^\s*module\s+(\S+)/m)?.[1];
      if (mod) goModules.push({ dir: d, module: mod });
    } else if (b === 'pubspec.yaml') {
      const name = read(f)?.match(/^name:\s*([\w]+)/m)?.[1];
      if (name) dartPackages.set(name, d);
    } else if (b === 'composer.json') {
      const auto = (readJson(f)?.autoload as { 'psr-4'?: Record<string, string | string[]> } | undefined)?.['psr-4'] ?? {};
      for (const [prefix, dirs] of Object.entries(auto)) for (const dd of [dirs].flat()) psr4.push({ prefix, dir: join(d, dd) });
    }
  }
  goModules.sort((a, b) => b.module.length - a.module.length);

  const symCache = new Map<string, Set<string>>();
  const symbolsOf = (file: string) => {
    let s = symCache.get(file);
    if (!s) symCache.set(file, (s = new Set(nodes[file]?.symbols.map((x) => x.name) ?? [])));
    return s;
  };

  return { files, dirFiles, tsconfigs, workspaces, goModules, dartPackages, psr4, namespaces, byBase, packages: [...packages].sort(), symbolsOf };
}

function loadTsConfig(rel: string, readJson: (rel: string) => Record<string, unknown> | null, files: Set<string>, depth = 0): TsConfig | null {
  const json = readJson(rel);
  if (!json) return null;
  const dir = dirOf(rel);
  let baseDir: string | null = null;
  let paths: TsConfig['paths'] = [];
  const ext = json.extends;
  if (typeof ext === 'string' && ext.startsWith('.') && depth < 3) {
    let target = join(dir, ext);
    if (!target.endsWith('.json')) target += '.json';
    if (files.has(target)) {
      const parent = loadTsConfig(target, readJson, files, depth + 1);
      if (parent) ({ baseDir, paths } = parent);
    }
  }
  const opts = (json.compilerOptions ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
  if (typeof opts.baseUrl === 'string') baseDir = join(dir, opts.baseUrl);
  if (opts.paths && typeof opts.paths === 'object') {
    const root = baseDir ?? dir;
    paths = Object.entries(opts.paths).map(([key, targets]) => {
      const star = key.indexOf('*');
      return {
        prefix: star < 0 ? key : key.slice(0, star),
        suffix: star < 0 ? '' : key.slice(star + 1),
        wildcard: star >= 0,
        targets: (Array.isArray(targets) ? targets : []).map((t) => join(root, t)),
      };
    });
    paths.sort((a, b) => b.prefix.length - a.prefix.length);
  }
  return { dir, baseDir, paths };
}

/** Resolve a file's raw imports to repo files (and external package names). */
export function resolveImports(file: string, node: FileNode, ctx: ResolveContext): Pick<FileNode, 'imports' | 'importNames' | 'external'> {
  const importNames: Record<string, Set<string>> = {};
  const external = new Set<string>();
  const hit = (targets: string[], names: string[]) => {
    for (const t of targets) {
      if (t === file) continue;
      const set = (importNames[t] ??= new Set());
      names.forEach((n) => set.add(n));
    }
  };
  for (const r of node.raw) {
    const res = resolveOne(file, node, r, ctx);
    if (res.length) hit(res, r.names);
    else {
      const ext = externalName(node.lang, r.spec);
      if (ext) external.add(ext);
    }
  }
  const imports = Object.keys(importNames).sort();
  return {
    imports,
    importNames: Object.fromEntries(imports.map((k) => [k, [...importNames[k]!].sort()])),
    external: [...external].sort(),
  };
}

function externalName(lang: FileNode['lang'], spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('mod:')) return null;
  if (lang === 'ts' || lang === 'js') return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
  if (lang === 'python') return spec.split('.')[0] || null;
  if (lang === 'rust') return /^(crate|self|super)$/.test(spec.split('::')[0]!) ? null : spec.split('::')[0]!;
  if (lang === 'dart') return spec.startsWith('package:') ? spec.slice(8).split('/')[0]! : spec.startsWith('dart:') ? spec : null;
  return spec;
}

function resolveOne(file: string, node: FileNode, r: RawImport, ctx: ResolveContext): string[] {
  switch (node.lang) {
    case 'ts':
    case 'js':
      return oneOrNone(resolveJs(file, r.spec, ctx));
    case 'python':
      return resolvePy(file, r, ctx);
    case 'go':
      return resolveGo(r.spec, ctx);
    case 'rust':
      return oneOrNone(resolveRust(file, r.spec, ctx));
    case 'java':
    case 'kotlin':
      return resolveJvm(r, ctx);
    case 'dart':
      return oneOrNone(resolveDart(file, r.spec, ctx));
    case 'ruby':
      return oneOrNone(resolveRuby(file, r.spec, ctx));
    case 'php':
      return resolvePhp(file, r, ctx);
    case 'csharp':
      return (ctx.namespaces.get(r.spec) ?? []).filter((f) => f !== file).slice(0, 15);
    default:
      return [];
  }
}

const oneOrNone = (f: string | null) => (f ? [f] : []);

function tryJs(p: string, ctx: ResolveContext): string | null {
  if (p.startsWith('..')) return null;
  const { files } = ctx;
  if (files.has(p) && /\.[\w]+$/.test(p)) return p;
  const swap = p.match(/^(.*)\.(js|jsx|mjs|cjs)$/);
  if (swap) {
    const stem = swap[1]!;
    const alts = swap[2] === 'mjs' ? ['.mts'] : swap[2] === 'cjs' ? ['.cts'] : ['.ts', '.tsx', '.d.ts'];
    for (const e of alts) if (files.has(stem + e)) return stem + e;
  }
  for (const e of JS_EXTS) if (files.has(p + e)) return p + e;
  for (const e of JS_EXTS) if (files.has(`${p}/index${e}`)) return `${p}/index${e}`;
  return null;
}

export function resolveJs(from: string, spec: string, ctx: ResolveContext): string | null {
  const clean = spec.split('?')[0]!.split('#')[0]!;
  if (clean.startsWith('./') || clean.startsWith('../') || clean === '.' || clean === '..') return tryJs(join(dirOf(from), clean), ctx);
  if (clean.startsWith('/')) return tryJs(clean.slice(1), ctx);
  const cfg = ctx.tsconfigs.find((t) => isUnder(from, t.dir));
  if (cfg) {
    for (const p of cfg.paths) {
      let star: string | null = null;
      if (p.wildcard) {
        if (clean.startsWith(p.prefix) && clean.endsWith(p.suffix) && clean.length >= p.prefix.length + p.suffix.length)
          star = clean.slice(p.prefix.length, clean.length - p.suffix.length);
      } else if (clean === p.prefix) star = '';
      if (star === null) continue;
      for (const t of p.targets) {
        const hit = tryJs(p.wildcard ? t.replace('*', star) : t, ctx);
        if (hit) return hit;
      }
    }
    if (cfg.baseDir !== null) {
      const hit = tryJs(join(cfg.baseDir, clean), ctx);
      if (hit) return hit;
    }
  }
  // Workspace packages: `@acme/ui` or `@acme/ui/button`.
  const parts = clean.split('/');
  const pkgName = clean.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  const ws = ctx.workspaces.get(pkgName);
  if (ws !== undefined) {
    const sub = clean.slice(pkgName.length).replace(/^\//, '');
    if (sub) return tryJs(join(ws, sub), ctx) ?? tryJs(join(ws, 'src', sub), ctx);
    return tryJs(join(ws, 'src/index'), ctx) ?? tryJs(join(ws, 'index'), ctx) ?? tryJs(join(ws, 'src'), ctx);
  }
  return null;
}

function resolvePy(from: string, r: RawImport, ctx: ResolveContext): string[] {
  const { files } = ctx;
  const tryMod = (p: string) => (files.has(`${p}.py`) ? `${p}.py` : files.has(`${p}/__init__.py`) ? `${p}/__init__.py` : files.has(`${p}.pyi`) ? `${p}.pyi` : null);
  const dots = r.spec.match(/^\.*/)![0].length;
  const rest = r.spec.slice(dots).split('.').filter(Boolean).join('/');
  const roots: string[] = [];
  if (dots) {
    let d = dirOf(from);
    for (let i = 1; i < dots; i++) d = dirOf(d);
    roots.push(d);
  } else {
    const seen = new Set<string>();
    for (const base of ['', 'src', 'lib', 'app', ...ctx.packages.flatMap((p) => [p, join(p, 'src')])]) {
      if (seen.has(base)) continue;
      seen.add(base);
      roots.push(base);
    }
  }
  for (const root of roots) {
    const modPath = join(root, rest);
    const out: string[] = [];
    // `from pkg import sub` may import submodules.
    for (const n of r.names) {
      if (n === '*') continue;
      const sub = tryMod(join(modPath, n));
      if (sub) out.push(sub);
    }
    const mod = rest || dots ? tryMod(modPath) : null;
    if (mod) out.push(mod);
    if (out.length) return [...new Set(out)];
  }
  return [];
}

function resolveGo(spec: string, ctx: ResolveContext): string[] {
  const mod = ctx.goModules.find((m) => spec === m.module || spec.startsWith(m.module + '/'));
  if (!mod) return [];
  const dir = join(mod.dir, spec.slice(mod.module.length).replace(/^\//, ''));
  return (ctx.dirFiles.get(dir) ?? []).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
}

function resolveRust(from: string, spec: string, ctx: ResolveContext): string | null {
  const { files } = ctx;
  const tryRs = (p: string) => (files.has(`${p}.rs`) ? `${p}.rs` : files.has(`${p}/mod.rs`) ? `${p}/mod.rs` : null);
  const fileBase = path.posix.basename(from, '.rs');
  const fileDir = dirOf(from);
  const isRootLike = ['mod', 'lib', 'main'].includes(fileBase);
  const selfDir = isRootLike ? fileDir : join(fileDir, fileBase);
  if (spec.startsWith('mod:')) return tryRs(join(selfDir, spec.slice(4)));
  const segs = spec.split('::');
  let base: string;
  if (segs[0] === 'crate') {
    let d = fileDir;
    while (d && !files.has(join(d, 'Cargo.toml'))) d = dirOf(d);
    base = join(d, 'src');
  } else if (segs[0] === 'self') base = selfDir;
  else if (segs[0] === 'super') base = dirOf(selfDir);
  else return null;
  for (let n = segs.length - 1; n >= 1; n--) {
    const hit = tryRs(join(base, ...segs.slice(1, n + 1)));
    if (hit) return hit;
  }
  return null;
}

function resolveJvm(r: RawImport, ctx: ResolveContext): string[] {
  const segs = r.spec.split('.');
  if (r.names.includes('*')) return (ctx.namespaces.get(r.spec) ?? []).slice(0, 15);
  // Class import: the file named after the class, under the package path.
  for (let n = segs.length; n >= 2; n--) {
    const cls = segs[n - 1]!;
    const tail = segs.slice(0, n).join('/');
    const hit = (ctx.byBase.get(cls) ?? []).find((f) => f.replace(/\.(java|kt|kts)$/, '').endsWith(tail));
    if (hit) return [hit];
  }
  // Kotlin top-level function or property: a file in the package that declares it.
  const pkg = segs.slice(0, -1).join('.');
  const name = segs[segs.length - 1]!;
  return (ctx.namespaces.get(pkg) ?? []).filter((f) => ctx.symbolsOf(f).has(name)).slice(0, 3);
}

function resolveDart(from: string, spec: string, ctx: ResolveContext): string | null {
  if (spec.startsWith('dart:')) return null;
  if (spec.startsWith('package:')) {
    const [name, ...rest] = spec.slice(8).split('/');
    const dir = ctx.dartPackages.get(name!);
    if (dir === undefined) return null;
    const p = join(dir, 'lib', ...rest);
    return ctx.files.has(p) ? p : null;
  }
  const p = join(dirOf(from), spec);
  return ctx.files.has(p) ? p : null;
}

function resolveRuby(from: string, spec: string, ctx: ResolveContext): string | null {
  const withExt = (p: string) => (ctx.files.has(p) ? p : ctx.files.has(`${p}.rb`) ? `${p}.rb` : null);
  if (spec.startsWith('./') || spec.startsWith('../')) return withExt(join(dirOf(from), spec));
  for (const base of ['lib', '', 'app']) {
    const hit = withExt(join(base, spec));
    if (hit) return hit;
  }
  return null;
}

function resolvePhp(from: string, r: RawImport, ctx: ResolveContext): string[] {
  if (r.spec.startsWith('./') || r.spec.endsWith('.php')) {
    const p = r.spec.startsWith('./') ? join(dirOf(from), r.spec) : r.spec;
    return ctx.files.has(p) ? [p] : [];
  }
  const fq = r.spec.replace(/^\\/, '');
  for (const { prefix, dir } of ctx.psr4) {
    if (!fq.startsWith(prefix)) continue;
    const p = join(dir, fq.slice(prefix.length).split('\\').join('/') + '.php');
    if (ctx.files.has(p)) return [p];
  }
  const segs = fq.split('\\');
  const cls = segs.pop()!;
  const inNs = (ctx.namespaces.get(segs.join('\\')) ?? []).filter((f) => ctx.symbolsOf(f).has(cls));
  if (inNs.length) return inNs.slice(0, 1);
  const tail = [...segs.slice(-1), cls].join('/') + '.php';
  const hit = (ctx.byBase.get(cls) ?? []).find((f) => f.endsWith(tail));
  return hit ? [hit] : [];
}

/** Source files a test covers: what it imports, plus a same-named source file (closest path wins). */
export function mapTests(nodes: Record<string, FileNode>, ctx: ResolveContext): void {
  for (const [file, node] of Object.entries(nodes)) {
    if (!node.isTest || node.lang === 'other') {
      node.testsFor = [];
      continue;
    }
    const out = new Set(node.imports.filter((f) => nodes[f] && !nodes[f]!.isTest && nodes[f]!.lang !== 'other').slice(0, 10));
    const candidates = (ctx.byBase.get(testBaseName(file)) ?? []).filter((f) => !isTestPath(f));
    if (candidates.length) {
      const score = (f: string) => {
        const a = dirOf(file).split('/');
        const b = dirOf(f).split('/');
        let s = 0;
        for (const seg of b) if (a.includes(seg)) s++;
        return s - Math.abs(a.length - b.length) * 0.1;
      };
      out.add([...candidates].sort((x, y) => score(y) - score(x) || x.localeCompare(y))[0]!);
    }
    node.testsFor = [...out].sort();
  }
}
