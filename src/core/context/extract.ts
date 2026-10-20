import { createHash } from 'node:crypto';
import path from 'node:path';
import { maskSource } from './lexer.js';
import type { CodeSymbol, Lang, RawImport, SymbolKind } from './types.js';

/** What a single file says about itself, before imports are resolved against the rest of the repo. */
export interface Extracted {
  lang: Lang;
  hash: string;
  lines: number;
  size: number;
  raw: RawImport[];
  symbols: CodeSymbol[];
  namespace?: string;
  isTest: boolean;
}

const EXT_LANG: Record<string, Lang> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js',
  py: 'python', pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  dart: 'dart',
  rb: 'ruby', rake: 'ruby',
  php: 'php',
  swift: 'swift',
  cs: 'csharp',
};

export function langOf(rel: string): Lang {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  return rel.includes('.') ? (EXT_LANG[ext] ?? 'other') : 'other';
}

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

const TEST_PATTERNS = [
  /(^|\/)(__tests__|__test__|tests?|specs?|e2e|integration_tests)\//i,
  /\.(test|spec|e2e)\.[cm]?[jt]sx?$/,
  /_test\.(go|py|dart|exs?)$/,
  /(^|\/)test_[^/]+\.py$/,
  /\.test\.dart$/,
  /(Test|Tests|Spec|IT)\.(java|kt|swift|cs)$/,
  /_spec\.rb$/,
];

export function isTestPath(rel: string): boolean {
  return TEST_PATTERNS.some((r) => r.test(rel));
}

/** `src/foo.test.ts` → `foo`, `test_bar.py` → `bar`, `BazTest.java` → `Baz`. */
export function testBaseName(rel: string): string {
  let b = path.posix.basename(rel);
  b = b.slice(0, b.indexOf('.') > 0 ? b.indexOf('.') : undefined);
  return b.replace(/^test_/, '').replace(/(_test|_spec|Tests?|Spec|IT)$/, '');
}

/** Basename without any extension (`a.test.ts` → `a`). */
export function baseName(rel: string): string {
  const b = path.posix.basename(rel);
  return b.indexOf('.') > 0 ? b.slice(0, b.indexOf('.')) : b;
}

const SIG_MAX = 160;

/** The declaration's signature: its line, joined with following lines while brackets are open, cut at the body. */
function signatureAt(lines: string[], idx: number): string {
  let s = lines[idx]!.trim();
  let depth = 0;
  for (const c of s) depth += c === '(' ? 1 : c === ')' ? -1 : 0;
  for (let k = idx + 1; depth > 0 && k < Math.min(lines.length, idx + 6); k++) {
    const next = lines[k]!.trim();
    s += ' ' + next;
    for (const c of next) depth += c === '(' ? 1 : c === ')' ? -1 : 0;
  }
  s = s.replace(/\s+/g, ' ');
  // Cut at the body: the first `{` outside brackets that isn't a type literal (`= {`, `: {`).
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    else if (ch === '{' && d === 0 && !/[=:]\s*$/.test(s.slice(0, i))) {
      s = s.slice(0, i);
      break;
    }
  }
  s = s.trim();
  return s.length > SIG_MAX ? s.slice(0, SIG_MAX - 1) + '…' : s;
}

/** Facts about one file: language, hash, imports as written, top-level symbols, routes, test-ness. */
export function extractFile(rel: string, content: string): Extracted {
  const lang = langOf(rel);
  const lines = content.split('\n');
  const base: Extracted = {
    lang,
    hash: sha1(content),
    lines: lines.length,
    size: Buffer.byteLength(content),
    raw: [],
    symbols: [],
    isTest: lang !== 'other' && isTestPath(rel),
  };
  if (lang === 'other') return base;
  const code = maskSource(content, lang, false); // comments gone, strings kept (import specifiers live in strings)
  const bare = maskSource(content, lang, true); // comments and string contents gone
  const ctx: LangCtx = { rel, lines, codeLines: code.split('\n'), bareLines: bare.split('\n'), code, bare, symbols: [], raw: [] };
  const result = EXTRACTORS[lang](ctx);
  base.raw = dedupeImports(ctx.raw);
  base.symbols = dedupeSymbols(ctx.symbols);
  if (result?.namespace) base.namespace = result.namespace;
  return base;
}

interface LangCtx {
  rel: string;
  lines: string[];
  codeLines: string[];
  bareLines: string[];
  code: string;
  bare: string;
  symbols: CodeSymbol[];
  raw: RawImport[];
}

type Extractor = (c: LangCtx) => { namespace?: string } | void;

const lineOf = (text: string, index: number) => {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

const add = (c: LangCtx, name: string, kind: SymbolKind, idx: number, exported: boolean, signature?: string) =>
  c.symbols.push({ name, kind, line: idx + 1, signature: signature ?? signatureAt(c.lines, idx), exported });

const isPascal = (s: string) => /^[A-Z][A-Za-z0-9]*$/.test(s) && /[a-z]/.test(s);
const splitNames = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function dedupeImports(list: RawImport[]): RawImport[] {
  const m = new Map<string, Set<string>>();
  for (const r of list) {
    const set = m.get(r.spec) ?? new Set<string>();
    r.names.forEach((n) => set.add(n));
    m.set(r.spec, set);
  }
  return [...m.entries()].map(([spec, names]) => ({ spec, names: [...names].sort() })).sort((a, b) => a.spec.localeCompare(b.spec));
}

function dedupeSymbols(list: CodeSymbol[]): CodeSymbol[] {
  const seen = new Set<string>();
  return list
    .sort((a, b) => a.line - b.line)
    .filter((s) => {
      const k = `${s.name}:${s.line}:${s.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// ── JavaScript / TypeScript ────────────────────────────────────────────────

const SERVER_MARKERS = /\bnew\s+Hono\b|from\s+['"](hono|express|fastify|koa|@koa\/router|elysia)['"]|require\(\s*['"]express['"]\s*\)|\bexpress\s*\(\s*\)|\bRouter\s*\(\s*\)/;
const HTTP_CLIENTS = new Set(['axios', 'http', 'https', 'client', 'request', 'ky', 'got', 'superagent', 'fetch', 'map', 'params', 'searchParams', 'headers', 'cache', 'store', 'cookies', 'localStorage', 'url']);

function jsImportNames(clause: string): string[] {
  const names: string[] = [];
  const c = clause.replace(/\btype\s+/g, '').trim();
  const brace = c.match(/\{([^}]*)\}/);
  if (brace) for (const part of splitNames(brace[1]!)) names.push(part.split(/\s+as\s+/)[0]!.trim());
  if (/\*\s+as\s+\w+/.test(c) || /^\*/.test(c)) names.push('*');
  const def = c.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').split(',')[0]!.trim();
  if (def && /^[\w$]+$/.test(def)) names.push('default');
  return names.filter((n) => n && n !== 'type');
}

const jsExtract: Extractor = (c) => {
  const { code } = c;
  // Inside a template literal or string? Then it's text, not code.
  const live = (m: RegExpMatchArray, word: string) => {
    const at = m.index! + m[0].indexOf(word);
    return c.bare[at] === code[at];
  };
  // import/export … from 'x'
  for (const m of code.matchAll(/(?:^|[^.\w$])(import|export)\s+((?:type\s+)?[^'"`;]*?)\s+from\s*(['"])([^'"\n]+)\3/g)) {
    if (!live(m, m[1]!)) continue;
    const names = m[1] === 'import' ? jsImportNames(m[2]!) : m[2]!.trim().startsWith('*') ? ['*'] : jsImportNames(m[2]!);
    c.raw.push({ spec: m[4]!, names });
  }
  for (const m of code.matchAll(/(?:^|[^.\w$])import\s*(['"])([^'"\n]+)\1/g)) if (live(m, 'import')) c.raw.push({ spec: m[2]!, names: [] });
  for (const m of code.matchAll(/\b(require|import)\s*\(\s*(['"`])([^'"`\n$]+)\2\s*\)/g)) if (live(m, m[1]!)) c.raw.push({ spec: m[3]!, names: ['*'] });

  const jsx = /\.(tsx|jsx)$/.test(c.rel);
  const localIdx = new Map<string, number>();
  c.bareLines.forEach((bl, idx) => {
    if (/^\s/.test(bl)) return;
    let m = bl.match(/^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function\*?|class|interface|type|enum|const\s+enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/);
    if (m) {
      const kw = m[6]!;
      const name = m[7]!;
      const exported = !!m[1];
      const rest = bl.slice(m[0].length);
      let kind: SymbolKind =
        kw.startsWith('function') ? 'function' : kw === 'class' ? 'class' : kw === 'interface' ? 'interface' : kw === 'type' ? 'type' : kw.includes('enum') ? 'enum' : 'const';
      if (kind === 'const' && /^\s*(:[^=]*)?=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*(:[^=]*)?=>|^\s*(:[^=]*)?=\s*(async\s+)?function\b|^\s*(:[^=]*)?=\s*(async\s*)?(<[^>]*>)?\(\s*$/.test(rest)) kind = 'function';
      if (jsx && isPascal(name) && (kind === 'function' || (kind === 'const' && /=\s*(React\.)?(memo|forwardRef)\s*\(/.test(rest)))) kind = 'component';
      add(c, name, kind, idx, exported);
      localIdx.set(name, c.symbols.length - 1);
      return;
    }
    m = bl.match(/^export\s+default\s+(async\s+)?(function|class)?\s*\(?/);
    if (m) {
      add(c, 'default', m[2] === 'class' ? 'class' : m[2] ? 'function' : 'const', idx, true);
      return;
    }
    m = bl.match(/^export\s+(type\s+)?\{([^}]*)\}\s*(from\b)?/);
    if (m && !m[3]) {
      for (const part of splitNames(m[2]!)) {
        const [orig, alias] = part.replace(/^type\s+/, '').split(/\s+as\s+/).map((s) => s.trim());
        const at = localIdx.get(orig!);
        if (at !== undefined) c.symbols[at]!.exported = true;
        if (alias && alias !== orig) add(c, alias, at !== undefined ? c.symbols[at]!.kind : 'const', idx, true);
      }
    }
  });

  // HTTP routes: hono/express-style servers.
  if (SERVER_MARKERS.test(code) && !isTestPath(c.rel)) {
    for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|all|options|head)\s*\(\s*(['"`])(\/[^'"`\n]*)\3/g)) {
      if (HTTP_CLIENTS.has(m[1]!) || !live(m, m[1]!)) continue;
      const idx = lineOf(code, m.index!) - 1;
      add(c, `${m[2]!.toUpperCase()} ${m[4]}`, 'route', idx, true);
    }
  }
  // Next.js app router and pages/api.
  const appRoute = c.rel.match(/(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/);
  if (appRoute) {
    const url = nextUrl(appRoute[1]!);
    for (const s of [...c.symbols]) if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(s.name) && s.exported) add(c, `${s.name} ${url}`, 'route', s.line - 1, true);
  }
  const appPage = c.rel.match(/(?:^|\/)app\/(.*?)\/?page\.[jt]sx?$/);
  if (appPage) add(c, `PAGE ${nextUrl(appPage[1]!)}`, 'route', 0, true, `page ${c.rel}`);
  const pagesApi = c.rel.match(/(?:^|\/)pages\/(api\/.+?)(\/index)?\.[jt]sx?$/);
  if (pagesApi) add(c, `ANY /${pagesApi[1]}`, 'route', 0, true, `api ${c.rel}`);
};

function nextUrl(seg: string): string {
  const parts = seg
    .split('/')
    .filter((p) => p && !/^\(.*\)$/.test(p) && !p.startsWith('@'));
  return '/' + parts.join('/');
}

// ── Python ──────────────────────────────────────────────────────────────────

const pyExtract: Extractor = (c) => {
  c.codeLines.forEach((line, idx) => {
    let m = line.match(/^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)$/);
    if (m) {
      let names = m[2]!.replace(/[()\\]/g, '');
      // Parenthesised multi-line import list.
      if (m[2]!.includes('(') && !m[2]!.includes(')')) {
        for (let k = idx + 1; k < c.codeLines.length && k < idx + 40; k++) {
          names += ',' + c.codeLines[k]!.replace(/[()\\]/g, '');
          if (c.codeLines[k]!.includes(')')) break;
        }
      }
      c.raw.push({ spec: m[1]!, names: splitNames(names).map((n) => n.split(/\s+as\s+/)[0]!.trim()).filter((n) => /^[\w*]+$/.test(n)) });
      return;
    }
    m = line.match(/^\s*import\s+(.+)$/);
    if (m) for (const part of splitNames(m[1]!)) c.raw.push({ spec: part.split(/\s+as\s+/)[0]!.trim(), names: ['*'] });
  });
  c.bareLines.forEach((bl, idx) => {
    let m = bl.match(/^(async\s+)?def\s+(\w+)/);
    if (m) return add(c, m[2]!, 'function', idx, !m[2]!.startsWith('_'));
    m = bl.match(/^class\s+(\w+)/);
    if (m) return add(c, m[1]!, 'class', idx, !m[1]!.startsWith('_'));
    m = bl.match(/^([A-Z][A-Z0-9_]*)\s*(:[^=]*)?=/);
    if (m) return add(c, m[1]!, 'const', idx, true);
  });
  c.codeLines.forEach((line, idx) => {
    const m = line.match(/^\s*@\s*[\w.]+\.(get|post|put|delete|patch|route|api_route|websocket)\(\s*['"]([^'"]+)['"](.*)$/);
    if (!m) return;
    let method = m[1]!.toUpperCase();
    if (method === 'ROUTE' || method === 'API_ROUTE') {
      const methods = m[3]!.match(/methods\s*=\s*\[([^\]]*)\]/);
      method = methods ? methods[1]!.replace(/['"\s]/g, '').toUpperCase() || 'GET' : 'GET';
    }
    let fnIdx = idx + 1;
    while (fnIdx < c.lines.length && !/^\s*(async\s+)?def\s/.test(c.bareLines[fnIdx]!)) fnIdx++;
    add(c, `${method} ${m[2]}`, 'route', idx, true, fnIdx < c.lines.length ? signatureAt(c.lines, fnIdx) : undefined);
  });
};

// ── Go ──────────────────────────────────────────────────────────────────────

const goExtract: Extractor = (c) => {
  const pkg = c.code.match(/^\s*package\s+(\w+)/m)?.[1];
  for (const m of c.code.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) c.raw.push({ spec: m[1]!, names: ['*'] });
  for (const m of c.code.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) for (const s of m[1]!.matchAll(/"([^"]+)"/g)) c.raw.push({ spec: s[1]!, names: ['*'] });
  const exp = (n: string) => /^[A-Z]/.test(n);
  let group: 'const' | 'var' | 'type' | null = null;
  c.bareLines.forEach((bl, idx) => {
    if (group) {
      if (/^\)/.test(bl)) group = null;
      else {
        const g = bl.match(/^\t(\w+)/);
        if (g) add(c, g[1]!, group === 'type' ? 'type' : 'const', idx, exp(g[1]!));
      }
      return;
    }
    let m = bl.match(/^func\s+(\([^)]*\)\s*)?(\w+)/);
    if (m) return add(c, m[2]!, m[1] ? 'method' : 'function', idx, exp(m[2]!));
    m = bl.match(/^type\s+(\w+)\s+(struct|interface)?/);
    if (m) return add(c, m[1]!, m[2] === 'interface' ? 'interface' : m[2] === 'struct' ? 'class' : 'type', idx, exp(m[1]!));
    m = bl.match(/^(const|var|type)\s*\(/);
    if (m) {
      group = m[1] as 'const' | 'var' | 'type';
      return;
    }
    m = bl.match(/^(const|var)\s+(\w+)/);
    if (m) add(c, m[2]!, 'const', idx, exp(m[2]!));
  });
  // net/http, gin, echo, chi, fiber: r.GET("/x", …), mux.HandleFunc("/x", …)
  for (const m of c.code.matchAll(/\.\s*(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|HandleFunc|Handle)\s*\(\s*"(\/[^"]*)"/g)) {
    const method = /^Handle/.test(m[1]!) ? 'ANY' : m[1]!.toUpperCase();
    add(c, `${method} ${m[2]}`, 'route', lineOf(c.code, m.index!) - 1, true);
  }
  return { namespace: pkg };
};

// ── Rust ────────────────────────────────────────────────────────────────────

const rustExtract: Extractor = (c) => {
  for (const m of c.code.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm)) {
    const body = m[1]!.replace(/\s+/g, '');
    const brace = body.match(/^(.*?)::\{(.*)\}$/);
    if (brace) c.raw.push({ spec: brace[1]!, names: splitNames(brace[2]!).map((n) => n.split('::')[0]!.split(' as ')[0]!) });
    else {
      const parts = body.split(' as ')[0]!.split('::');
      const last = parts.pop()!;
      c.raw.push({ spec: parts.join('::') || last, names: parts.length ? [last] : ['*'] });
    }
  }
  for (const m of c.code.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) c.raw.push({ spec: `mod:${m[1]}`, names: ['*'] });
  c.bareLines.forEach((bl, idx) => {
    let m = bl.match(/^(pub(\([^)]*\))?\s+)?((async|const|unsafe|extern\s+"\s*")\s+)*(fn|struct|enum|trait|type|const|static|union|macro_rules!)\s+(\w+)/);
    if (m) {
      const kw = m[5]!;
      const kind: SymbolKind = kw === 'fn' ? 'function' : kw === 'struct' || kw === 'union' ? 'class' : kw === 'enum' ? 'enum' : kw === 'trait' ? 'interface' : kw === 'type' ? 'type' : 'const';
      return add(c, m[6]!, kind, idx, !!m[1] || kw === 'macro_rules!');
    }
    m = bl.match(/^ {4}pub(\([^)]*\))?\s+((async|const|unsafe)\s+)*fn\s+(\w+)/);
    if (m) add(c, m[4]!, 'method', idx, true);
  });
  // actix/rocket: #[get("/x")]
  for (const m of c.code.matchAll(/#\[(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g)) add(c, `${m[1]!.toUpperCase()} ${m[2]}`, 'route', lineOf(c.code, m.index!) - 1, true);
};

// ── Java / Kotlin ───────────────────────────────────────────────────────────

const javaLike =
  (kotlin: boolean): Extractor =>
  (c) => {
    const pkg = c.code.match(/^\s*package\s+([\w.]+)/m)?.[1];
    for (const m of c.code.matchAll(/^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)(?:\s+as\s+\w+)?\s*;?/gm)) {
      const spec = m[2]!;
      c.raw.push({ spec: spec.replace(/\.\*$/, ''), names: spec.endsWith('.*') ? ['*'] : [spec.split('.').pop()!] });
    }
    c.bareLines.forEach((bl, idx) => {
      if (kotlin) {
        const m = bl.match(/^((?:public|internal|private|protected|open|abstract|sealed|data|enum|annotation|inline|value|suspend|override|inner|companion|const|expect|actual)\s+)*(class|interface|object|fun|val|var|typealias)\s+(?:<[^>]*>\s*)?([\w.]+)/);
        if (m) {
          const mods = m[1] ?? '';
          const kw = m[2]!;
          const name = m[3]!.split('.').pop()!;
          const kind: SymbolKind = kw === 'fun' ? 'function' : kw === 'interface' ? 'interface' : kw === 'typealias' ? 'type' : kw === 'val' || kw === 'var' ? 'const' : /\benum\b/.test(bl) ? 'enum' : 'class';
          const composable = kw === 'fun' && idx > 0 && /@Composable/.test(c.bareLines[idx - 1]!);
          return add(c, name, composable ? 'component' : kind, idx, !/\b(private|internal)\b/.test(mods));
        }
        const fn = bl.match(/^ {4}((?:public|override|open|suspend|protected)\s+)*fun\s+(?:<[^>]*>\s*)?([\w.]+)\s*\(/);
        if (fn && !/\bprivate\b/.test(bl)) add(c, fn[2]!.split('.').pop()!, 'method', idx, true);
        return;
      }
      const m = bl.match(/^ {0,4}((?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record|@interface)\s+(\w+)/);
      if (m) {
        const kw = m[2]!;
        return add(c, m[3]!, kw === 'interface' || kw === '@interface' ? 'interface' : kw === 'enum' ? 'enum' : 'class', idx, !/\bprivate\b/.test(m[1] ?? ''));
      }
      const meth = bl.match(/^ {4}(public|protected)\s+((?:static|final|abstract|synchronized|default)\s+)*(<[^>]*>\s+)?[\w<>[\],.?]+\s+(\w+)\s*\(/);
      if (meth) add(c, meth[4]!, 'method', idx, true);
    });
    // Spring: @GetMapping("/x")
    for (const m of c.code.matchAll(/@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"/g)) {
      add(c, `${m[1] === 'Request' ? 'ANY' : m[1]!.toUpperCase()} ${m[2]}`, 'route', lineOf(c.code, m.index!) - 1, true);
    }
    return { namespace: pkg };
  };

// ── Dart ────────────────────────────────────────────────────────────────────

const dartExtract: Extractor = (c) => {
  for (const m of c.code.matchAll(/^\s*(import|export|part)\s+(['"])([^'"]+)\2([^;]*);/gm)) {
    const show = m[4]!.match(/\bshow\s+([\w\s,]+)/);
    c.raw.push({ spec: m[3]!, names: show ? splitNames(show[1]!) : ['*'] });
  }
  c.bareLines.forEach((bl, idx) => {
    let m = bl.match(/^((?:abstract|sealed|base|final|interface|mixin)\s+)*(class|mixin|enum|extension|typedef)\s+(\w+)/);
    if (m) {
      const kw = m[2]!;
      const widget = /\bextends\s+(StatelessWidget|StatefulWidget|ConsumerWidget|HookWidget|ConsumerStatefulWidget)\b/.test(bl);
      const kind: SymbolKind = widget ? 'component' : kw === 'enum' ? 'enum' : kw === 'typedef' ? 'type' : 'class';
      return add(c, m[3]!, kind, idx, !m[3]!.startsWith('_'));
    }
    m = bl.match(/^(?:const|final|var|late)\s+(?:[\w<>?,]+\s+)?(\w+)\s*=/);
    if (m) return add(c, m[1]!, 'const', idx, !m[1]!.startsWith('_'));
    m = bl.match(/^(?!(?:import|export|part|library|return|if|for|while|switch|class|enum)\b)[\w<>?,[\]]+(?:\s+[\w<>?,[\]]+)*\s+(\w+)\s*(<[^>]*>)?\s*\(/);
    if (m) add(c, m[1]!, 'function', idx, !m[1]!.startsWith('_'));
  });
};

// ── Ruby ────────────────────────────────────────────────────────────────────

const rubyExtract: Extractor = (c) => {
  for (const m of c.code.matchAll(/^\s*require_relative\s+(['"])([^'"]+)\1/gm)) c.raw.push({ spec: `./${m[2]}`, names: ['*'] });
  for (const m of c.code.matchAll(/^\s*require\s+(['"])([^'"]+)\1/gm)) c.raw.push({ spec: m[2]!, names: ['*'] });
  c.bareLines.forEach((bl, idx) => {
    let m = bl.match(/^\s*(class|module)\s+([A-Z][\w:]*)/);
    if (m) return add(c, m[2]!, m[1] === 'module' ? 'type' : 'class', idx, true);
    m = bl.match(/^(\s*)def\s+(self\.)?(\w+[?!=]?)/);
    if (m) add(c, m[3]!, m[1] ? 'method' : 'function', idx, !m[3]!.startsWith('_'));
  });
  if (/(^|\/)routes\.rb$/.test(c.rel)) {
    c.codeLines.forEach((line, idx) => {
      const m = line.match(/^\s*(get|post|put|patch|delete)\s+(['"])([^'"]+)\2/);
      if (m) add(c, `${m[1]!.toUpperCase()} ${m[3]}`, 'route', idx, true);
    });
  }
};

// ── PHP ─────────────────────────────────────────────────────────────────────

const phpExtract: Extractor = (c) => {
  const ns = c.code.match(/^\s*namespace\s+([\w\\]+)\s*;/m)?.[1];
  for (const m of c.code.matchAll(/^\s*use\s+(function\s+|const\s+)?([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm)) c.raw.push({ spec: m[2]!, names: [m[2]!.split('\\').pop()!] });
  for (const m of c.code.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(__DIR__\s*\.\s*)?(['"])([^'"]+)\2/g)) {
    const p = m[3]!.replace(/^\//, '');
    c.raw.push({ spec: m[1] || p.startsWith('.') ? `./${p.replace(/^\.\//, '')}` : p, names: ['*'] });
  }
  c.bareLines.forEach((bl, idx) => {
    let m = bl.match(/^\s*((?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+(\w+)/);
    if (m) return add(c, m[3]!, m[2] === 'interface' ? 'interface' : m[2] === 'enum' ? 'enum' : 'class', idx, true);
    m = bl.match(/^(\s*)((?:public|protected|private|static|abstract|final)\s+)*function\s+&?(\w+)/);
    if (m) add(c, m[3]!, m[1] ? 'method' : 'function', idx, !/\bprivate\b/.test(m[2] ?? ''));
  });
  for (const m of c.code.matchAll(/Route::(get|post|put|patch|delete|any)\(\s*(['"])([^'"]+)\2/g)) {
    add(c, `${m[1]!.toUpperCase()} ${m[3]!.startsWith('/') ? m[3] : '/' + m[3]}`, 'route', lineOf(c.code, m.index!) - 1, true);
  }
  return { namespace: ns };
};

// ── Swift ───────────────────────────────────────────────────────────────────

const swiftExtract: Extractor = (c) => {
  for (const m of c.code.matchAll(/^\s*(?:@\w+\s+)*import\s+(?:class\s+|struct\s+|enum\s+|func\s+)?([\w.]+)/gm)) c.raw.push({ spec: m[1]!, names: ['*'] });
  c.bareLines.forEach((bl, idx) => {
    const m = bl.match(/^( {0,4})((?:public|open|internal|private|fileprivate|final|static|class|override|mutating|nonisolated|@\w+(?:\([^)]*\))?)\s+)*(class|struct|enum|protocol|extension|actor|func|typealias)\s+([\w.]+)/);
    if (!m) return;
    if (m[1] && m[3] !== 'func') return;
    const kw = m[3]!;
    const view = /:\s*(some\s+)?View\b/.test(bl) && kw === 'struct';
    const kind: SymbolKind = view ? 'component' : kw === 'func' ? (m[1] ? 'method' : 'function') : kw === 'protocol' ? 'interface' : kw === 'enum' ? 'enum' : kw === 'typealias' ? 'type' : 'class';
    add(c, m[4]!, kind, idx, !/\b(private|fileprivate)\b/.test(m[2] ?? ''));
  });
};

// ── C# ──────────────────────────────────────────────────────────────────────

const csExtract: Extractor = (c) => {
  const ns = c.code.match(/^\s*namespace\s+([\w.]+)/m)?.[1];
  for (const m of c.code.matchAll(/^\s*(?:global\s+)?using\s+(static\s+)?([\w.]+)\s*;/gm)) c.raw.push({ spec: m[2]!, names: ['*'] });
  c.bareLines.forEach((bl, idx) => {
    let m = bl.match(/^\s*((?:public|internal|private|protected|static|abstract|sealed|partial|readonly|ref|file)\s+)*(class|interface|struct|enum|record)\s+(\w+)/);
    if (m) return add(c, m[3]!, m[2] === 'interface' ? 'interface' : m[2] === 'enum' ? 'enum' : 'class', idx, !/\b(private|file)\b/.test(m[1] ?? ''));
    m = bl.match(/^\s+(public|protected|internal)\s+((?:static|async|virtual|override|abstract|sealed|new)\s+)*[\w<>[\],.?]+\s+(\w+)\s*(<[^>]*>)?\s*\(/);
    if (m) add(c, m[3]!, 'method', idx, true);
  });
  for (const m of c.code.matchAll(/\[Http(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) add(c, `${m[1]!.toUpperCase()} ${m[2]}`, 'route', lineOf(c.code, m.index!) - 1, true);
  for (const m of c.code.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/g)) add(c, `${m[1]!.toUpperCase()} ${m[2]}`, 'route', lineOf(c.code, m.index!) - 1, true);
  return { namespace: ns };
};

const EXTRACTORS: Record<Lang, Extractor> = {
  ts: jsExtract,
  js: jsExtract,
  python: pyExtract,
  go: goExtract,
  rust: rustExtract,
  java: javaLike(false),
  kotlin: javaLike(true),
  dart: dartExtract,
  ruby: rubyExtract,
  php: phpExtract,
  swift: swiftExtract,
  csharp: csExtract,
  other: () => {},
};
