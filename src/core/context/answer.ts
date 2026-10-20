import { readIndexable } from './scan.js';
import type { ContextGraph } from './types.js';

/** A `path:line` (or `path:a-b`, `path#symbol`) found in an answer, checked against the graph. */
export interface AnswerCite {
  raw: string;
  file: string;
  line?: number;
  endLine?: number;
  moduleId: string | null;
  ok: boolean;
}

/** Most hits `code_grep` returns. */
export const GREP_MAX_HITS = 60;
/** Most lines `code_read` returns at once. */
export const READ_MAX_LINES = 220;

const CITE_RE = /(?<![\w/.-])((?:[\w@.+\-[\]()]+\/)*[\w@.+\-[\]()]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?:\s*[-–]\s*(\d+))?|#([A-Za-z_$][\w$]*))?/g;

/**
 * Finds file citations in an answer. A path the model shortened (`ask.service.ts:40`) is resolved
 * to the one indexed file that ends with it; anything else that isn't indexed, or a line past the
 * end of the file, comes back with `ok: false`.
 */
export function extractCitations(text: string, graph: ContextGraph): AnswerCite[] {
  const out = new Map<string, AnswerCite>();
  const files = Object.keys(graph.files);
  // Markdown links: keep the visible text; a link target that repeats it adds nothing.
  const plain = stripLinkTargets(text);
  for (const m of plain.matchAll(CITE_RE)) {
    const [raw, p, l, e, sym] = m;
    // Plain words with a dot ("e.g", "Node.js") only count when they carry a line or symbol, or are a known path.
    const resolved = resolveFile(p!, graph, files);
    if (!resolved && !l && !sym) continue;
    const file = resolved ?? p!;
    const node = graph.files[file];
    let line = l ? Number(l) : undefined;
    const endLine = e ? Number(e) : undefined;
    if (sym && node) line = node.symbols.find((s) => s.name === sym)?.line;
    const ok = !!node && (line === undefined || (line >= 1 && line <= node.lines)) && (endLine === undefined || (endLine >= (line ?? 1) && endLine <= node.lines)) && (!sym || line !== undefined);
    const key = `${file}:${line ?? ''}:${endLine ?? ''}`;
    if (!out.has(key)) out.set(key, { raw: raw!, file, ...(line !== undefined ? { line } : {}), ...(endLine !== undefined ? { endLine } : {}), moduleId: graph.fileModule[file] ?? null, ok });
  }
  return [...out.values()];
}

const FILLER_RE = /^(perfect|great|excellent|okay|ok|alright|good|now i (have|can|understand)|let me|i('ll| will| now| have| can)|based on (my|the|this) (research|investigation|exploration|search))\b/i;

/** Drops the "Perfect! Now I have the full picture." lines a model sometimes starts with. */
export function tidyAnswer(text: string): string {
  const paras = text.trim().split(/\n\s*\n/);
  let i = 0;
  while (i < Math.min(2, paras.length - 1) && !paras[i]!.includes('\n') && paras[i]!.length <= 160 && FILLER_RE.test(paras[i]!.trim())) i++;
  return paras.slice(i).join('\n\n');
}

/** `[label](target)` → `label` (and `[label](target)` with a code label → the code). */
export function stripLinkTargets(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label: string, target: string) =>
    /[:#]/.test(label) || target.includes('://') || !/\.[A-Za-z0-9]{1,8}([:#]|$)/.test(target) ? label : `${label} \`${target}\``,
  );
}

function resolveFile(p: string, graph: ContextGraph, files: string[]): string | null {
  const clean = p.replace(/^\.\//, '');
  if (graph.files[clean]) return clean;
  if (!clean.includes('.')) return null;
  const tail = '/' + clean;
  const hits = files.filter((f) => f.endsWith(tail));
  return hits.length === 1 ? hits[0]! : null;
}

/** Modules cited, most cited first. */
export function citedModules(cites: AnswerCite[]): string[] {
  const n = new Map<string, number>();
  for (const c of cites) if (c.ok && c.moduleId) n.set(c.moduleId, (n.get(c.moduleId) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

const UNSURE_RE = /\b(not sure|i'?m not certain|i am not certain|couldn'?t find|could not find|no (?:clear )?evidence|unable to (?:find|determine))\b/i;

/** The answer hedges, or has no citation that checks out. */
export function isUnsure(answer: string, cites: AnswerCite[]): boolean {
  return UNSURE_RE.test(answer.slice(0, 400)) || !cites.some((c) => c.ok);
}

/** Instructions for the Ask bot. The repo map goes first so the prefix stays cached. */
export function askSystemPrompt(index: string): string {
  return [
    'You answer questions about this codebase for a developer. You can only read: the repo map below, the context_* tools, code_grep and code_read.',
    '',
    'Rules:',
    '- Start from the map and context_find / context_module; use code_grep and code_read to confirm details. Keep tool calls few.',
    '- Every factual claim cites the code as `path/to/file.ts:LINE` (or `:START-END`) in backticks, with the full repo-relative path (no Markdown links). Only cite lines you have seen.',
    '- Module cards are a map, not the truth: when a card and the code disagree, the code wins.',
    '- If the code does not answer the question, say "Not sure:" and what you would check next. Never guess.',
    '- Answer in short Markdown: a 1–2 sentence answer first, then the details as a short list. No preamble.',
    '',
    '# Repository map',
    index.trim() || '(no map yet: use context_find)',
  ].join('\n');
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

/**
 * Searches indexed files only (so ignored files, secrets and `.agentroom/runs` are never read).
 * `pattern` is a regex when it compiles, else a literal; case-insensitive unless it has capitals.
 */
export function grepIndexed(root: string, graph: ContextGraph, pattern: string, opts: { path?: string; limit?: number } = {}): GrepHit[] {
  const limit = Math.min(opts.limit ?? 40, GREP_MAX_HITS);
  const flags = /[A-Z]/.test(pattern) ? '' : 'i';
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
  const prefix = (opts.path ?? '').replace(/^\.\//, '').replace(/\/$/, '');
  const hits: GrepHit[] = [];
  for (const file of Object.keys(graph.files).sort()) {
    if (prefix && file !== prefix && !file.startsWith(prefix + '/')) continue;
    const text = readIndexable(root, file);
    if (text === null) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i]!)) continue;
      hits.push({ file, line: i + 1, text: lines[i]!.trim().slice(0, 200) });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Numbered lines of an indexed file, or an error message for anything else. */
export function readIndexed(root: string, graph: ContextGraph, file: string, start = 1, end?: number): string {
  const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!graph.files[rel]) {
    const tail = '/' + rel;
    const hits = Object.keys(graph.files).filter((f) => f.endsWith(tail));
    if (hits.length !== 1) return `Not an indexed file: ${file}. Use context_find to locate it.`;
    return readIndexed(root, graph, hits[0]!, start, end);
  }
  const text = readIndexable(root, rel);
  if (text === null) return `Can't read ${rel}.`;
  const lines = text.split('\n');
  const s = Math.max(1, Math.min(start, lines.length));
  const e = Math.max(s, Math.min(end ?? s + READ_MAX_LINES - 1, lines.length, s + READ_MAX_LINES - 1));
  const width = String(e).length;
  const body = lines
    .slice(s - 1, e)
    .map((l, i) => `${String(s + i).padStart(width)}  ${l}`)
    .join('\n');
  return `${rel} (lines ${s}-${e} of ${lines.length})\n${body}`;
}
