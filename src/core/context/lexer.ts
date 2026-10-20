import type { Lang } from './types.js';

interface LexSpec {
  line: string[];
  block: [string, string][];
  /** Strings that end at the closing quote or the end of the line. */
  quotes: string[];
  /** Strings that may span lines (template literals, triple quotes, raw strings). */
  multi: string[];
}

const C_LIKE: LexSpec = { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], multi: [] };

const SPECS: Record<Lang, LexSpec> = {
  ts: { ...C_LIKE, multi: ['`'] },
  js: { ...C_LIKE, multi: ['`'] },
  python: { line: ['#'], block: [], quotes: ['"', "'"], multi: ['"""', "'''"] },
  go: { ...C_LIKE, multi: ['`'] },
  // `'` is a lifetime as often as a char literal, so it isn't a quote here.
  rust: { ...C_LIKE, quotes: ['"'] },
  java: { ...C_LIKE, multi: ['"""'] },
  kotlin: { ...C_LIKE, multi: ['"""'] },
  dart: { ...C_LIKE, multi: ['"""', "'''"] },
  ruby: { line: ['#'], block: [['=begin', '=end']], quotes: ['"', "'"], multi: [] },
  php: { line: ['//', '#'], block: [['/*', '*/']], quotes: ['"', "'"], multi: [] },
  swift: { ...C_LIKE, quotes: ['"'], multi: ['"""'] },
  csharp: { ...C_LIKE, multi: [] },
  other: { line: [], block: [], quotes: [], multi: [] },
};

/**
 * Same-length copy of `src` with comments blanked (and string contents too when `blankStrings`).
 * Newlines are kept, so line numbers and columns still line up with the original.
 * Single-line strings stop at the end of the line, which bounds the damage of a misread regex literal.
 */
export function maskSource(src: string, lang: Lang, blankStrings: boolean): string {
  const spec = SPECS[lang];
  if (!spec.line.length && !spec.quotes.length) return src;
  const multi = [...spec.multi].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let i = 0;
  const n = src.length;
  outer: while (i < n) {
    for (const d of multi) {
      if (src.startsWith(d, i)) {
        let j = i + d.length;
        while (j < n && !src.startsWith(d, j)) j += src[j] === '\\' ? 2 : 1;
        const end = Math.min(n, j + d.length);
        const body = src.slice(i + d.length, Math.min(j, n));
        out.push(d, blankStrings ? blank(body) : body, src.slice(Math.min(j, n), end));
        i = end;
        continue outer;
      }
    }
    for (const lc of spec.line) {
      if (src.startsWith(lc, i)) {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        out.push(blank(src.slice(i, j)));
        i = j;
        continue outer;
      }
    }
    for (const [open, close] of spec.block) {
      if (src.startsWith(open, i)) {
        let j = src.indexOf(close, i + open.length);
        j = j < 0 ? n : j + close.length;
        out.push(blank(src.slice(i, j)));
        i = j;
        continue outer;
      }
    }
    const ch = src[i]!;
    if (spec.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' && src[j + 1] !== '\n' ? 2 : 1;
      const body = src.slice(i + 1, Math.min(j, n));
      out.push(ch, blankStrings ? blank(body) : body);
      if (j < n && src[j] === ch) {
        out.push(ch);
        j += 1;
      }
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}
