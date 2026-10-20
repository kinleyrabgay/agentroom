import fs from 'node:fs';
import { parseFrontmatter } from '../fs/frontmatter.js';
import { contextPaths, writeFileAtomic } from './graph.js';
import type { CardDraft, CardGenerator, Claim, ContextGraph, ModuleCard, ModuleNode, Staleness } from './types.js';

export const CARD_MODEL = 'claude-haiku-4-5-20251001';
/** Prompt budget for one card (chars/4 estimate). */
export const CARD_PROMPT_TOKENS = 6000;
/** Share of a module's files that may change before its card is rewritten rather than re-hashed. */
export const REGEN_CHANGE_RATIO = 0.3;

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

const SECTIONS: { key: keyof Pick<CardDraft, 'entryPoints' | 'invariants' | 'gotchas' | 'howToChange'>; title: string }[] = [
  { key: 'entryPoints', title: 'Entry points' },
  { key: 'invariants', title: 'Invariants' },
  { key: 'gotchas', title: 'Gotchas' },
  { key: 'howToChange', title: 'How to change' },
];

// ── Citations ───────────────────────────────────────────────────────────────

export interface Citation {
  file: string;
  line?: number;
  symbol?: string;
}

/** `path:12`, `path#name`, `path:12#name`. */
export function parseCitation(raw: string): Citation | null {
  const m = raw.trim().replace(/^`|`$/g, '').match(/^([^\s:#`]+?)(?::(\d+)(?:-\d+)?)?(?:#([\w$.:-]+))?$/);
  if (!m) return null;
  return { file: m[1]!, ...(m[2] ? { line: Number(m[2]) } : {}), ...(m[3] ? { symbol: m[3] } : {}) };
}

/** Current line of a symbol (citations by symbol survive edits that shift lines). */
export function symbolLine(graph: ContextGraph, file: string, symbol: string): number | null {
  const node = graph.files[file];
  const hit = node?.symbols.find((s) => s.name === symbol) ?? node?.symbols.find((s) => s.name.endsWith(`.${symbol}`) || s.name.endsWith(` ${symbol}`));
  return hit ? hit.line : null;
}

/** Canonical form, or null when the file or symbol doesn't exist. Symbols win over lines: they don't drift. */
export function checkCitation(graph: ContextGraph, raw: string): string | null {
  const c = parseCitation(raw);
  if (!c) return null;
  const node = graph.files[c.file];
  if (!node) return null;
  if (c.symbol) {
    if (symbolLine(graph, c.file, c.symbol) !== null) return `${c.file}#${c.symbol}`;
    if (c.line === undefined) return null;
  }
  if (c.line !== undefined) return c.line >= 1 && c.line <= node.lines ? `${c.file}:${c.line}` : null;
  return c.file;
}

/** Renders a citation with today's line number (`path#sym` → `path:42`). */
export function renderCitation(graph: ContextGraph, raw: string): string {
  const c = parseCitation(raw);
  if (!c) return raw;
  if (c.symbol) {
    const line = symbolLine(graph, c.file, c.symbol);
    return line ? `${c.file}:${line}` : raw;
  }
  return raw;
}

/** Drops citations that don't resolve, then claims with none left. */
export function validateCitations(draft: CardDraft, graph: ContextGraph): { draft: CardDraft; dropped: number } {
  let dropped = 0;
  const fix = (list: Claim[]) =>
    list.flatMap((cl) => {
      const cite = [...new Set(cl.cite.map((c) => checkCitation(graph, c)).filter((c): c is string => !!c))];
      dropped += cl.cite.length - cite.length;
      if (!cite.length) {
        dropped += cl.cite.length ? 0 : 1;
        return [];
      }
      return [{ text: cl.text.trim(), cite }];
    });
  return {
    draft: {
      purpose: draft.purpose.trim(),
      entryPoints: fix(draft.entryPoints),
      invariants: fix(draft.invariants),
      gotchas: fix(draft.gotchas),
      howToChange: fix(draft.howToChange),
    },
    dropped,
  };
}

// ── Markdown ────────────────────────────────────────────────────────────────

const claimLine = (c: Claim) => `- ${c.text.replace(/\n+/g, ' ')} — ${c.cite.map((x) => `\`${x}\``).join(', ')}`;

export function renderCard(card: ModuleCard, mod?: Pick<ModuleNode, 'dir'>): string {
  const fm = [
    '---',
    `id: ${JSON.stringify(card.id)}`,
    `generatedAt: ${JSON.stringify(card.generatedAt)}`,
    `generatedAtSha: ${card.generatedAtSha ? JSON.stringify(card.generatedAtSha) : 'null'}`,
    ...(card.refreshedAt ? [`refreshedAt: ${JSON.stringify(card.refreshedAt)}`] : []),
    `surfaceHash: ${JSON.stringify(card.surfaceHash)}`,
    `sources: ${JSON.stringify(card.sources)}`,
    '---',
  ];
  const body = [`# ${card.id}${mod ? ` — \`${mod.dir || '.'}/\`` : ''}`, '', card.purpose || '_No summary yet._', ''];
  for (const s of SECTIONS) {
    body.push(`## ${s.title}`);
    body.push(...(card[s.key].length ? card[s.key].map(claimLine) : ['- _none_']));
    body.push('');
  }
  body.push('## Decisions', ...(card.decisions.length ? card.decisions.map((d) => `- ${d}`) : ['- _none_']), '');
  if (card.rejected.length) body.push('## Rejected', ...card.rejected.map((r) => `- ${r.replace(/\n+/g, ' ')}`), '');
  // Last on purpose: everything after this heading is the human's, verbatim.
  body.push('## Human notes', card.humanNotes);
  return `${fm.join('\n')}\n${body.join('\n').trimEnd()}\n`;
}

export function parseCard(text: string): ModuleCard | null {
  let data: Record<string, unknown>;
  let body: string;
  try {
    // gray-matter caches by content; that's fine for immutable input.
    ({ data, body } = parseFrontmatter(text));
  } catch {
    return null;
  }
  if (typeof data.id !== 'string' && typeof data.id !== 'number') return null;
  const notesAt = body.search(/^## Human notes[ \t]*$/m);
  const humanNotes = notesAt < 0 ? '' : body.slice(body.indexOf('\n', notesAt) + 1 || body.length).replace(/\s+$/, '');
  const main = notesAt < 0 ? body : body.slice(0, notesAt);
  const chunks = main.split(/^## /m);
  const head = chunks[0]!.split('\n').filter((l) => !l.startsWith('# '));
  const purpose = head.join('\n').trim().replace(/^_No summary yet\._$/, '');
  const section = (title: string) => chunks.find((c) => c.startsWith(title + '\n') || c.trimEnd() === title)?.slice(title.length) ?? '';
  const bullets = (s: string) =>
    s
      .split('\n')
      .filter((l) => l.startsWith('- ') && l.trim() !== '- _none_')
      .map((l) => l.slice(2));
  const claims = (title: string): Claim[] =>
    bullets(section(title)).map((l) => {
      const at = l.lastIndexOf(' — ');
      if (at < 0) return { text: l, cite: [] };
      const cites = [...l.slice(at + 3).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
      return cites.length ? { text: l.slice(0, at), cite: cites } : { text: l, cite: [] };
    });
  const sources = typeof data.sources === 'string' ? (JSON.parse(data.sources) as Record<string, string>) : ((data.sources ?? {}) as Record<string, string>);
  const str = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v));
  return {
    id: String(data.id),
    purpose,
    entryPoints: claims('Entry points'),
    invariants: claims('Invariants'),
    gotchas: claims('Gotchas'),
    howToChange: claims('How to change'),
    decisions: bullets(section('Decisions')),
    rejected: bullets(section('Rejected')),
    humanNotes,
    sources,
    surfaceHash: str(data.surfaceHash),
    generatedAt: str(data.generatedAt),
    generatedAtSha: data.generatedAtSha ? str(data.generatedAtSha) : null,
    ...(data.refreshedAt ? { refreshedAt: str(data.refreshedAt) } : {}),
  };
}

export function loadCard(root: string, id: string): ModuleCard | null {
  try {
    return parseCard(fs.readFileSync(contextPaths(root).card(id), 'utf8'));
  } catch {
    return null;
  }
}

export function saveCard(root: string, card: ModuleCard, mod?: Pick<ModuleNode, 'dir'>): void {
  writeFileAtomic(contextPaths(root).card(card.id), renderCard(card, mod));
}

export function listCardIds(root: string): string[] {
  try {
    return fs
      .readdirSync(contextPaths(root).modules)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

export function emptyCard(id: string): ModuleCard {
  return { id, purpose: '', entryPoints: [], invariants: [], gotchas: [], howToChange: [], decisions: [], rejected: [], humanNotes: '', sources: {}, surfaceHash: '', generatedAt: '', generatedAtSha: null };
}

// ── Staleness ───────────────────────────────────────────────────────────────

const allCites = (card: CardDraft) => SECTIONS.flatMap((s) => card[s.key].flatMap((c) => c.cite));

export function staleness(card: ModuleCard, mod: ModuleNode, graph: ContextGraph): Staleness {
  const changed = new Set<string>();
  for (const f of mod.files) if (card.sources[f] !== graph.files[f]?.hash) changed.add(f);
  for (const f of Object.keys(card.sources)) if (!graph.files[f] || graph.fileModule[f] !== mod.id) changed.add(f);
  const brokenCites = allCites(card).filter((c) => checkCitation(graph, c) === null);
  const surfaceChanged = card.surfaceHash !== mod.surfaceHash;
  const changedFiles = [...changed].sort();
  return { stale: changedFiles.length > 0 || surfaceChanged || brokenCites.length > 0, changedFiles, surfaceChanged, brokenCites };
}

/** Rewrite when there's no real card, the public surface moved, citations broke, or too much changed. */
export function needsRegeneration(card: ModuleCard | null, mod: ModuleNode, graph: ContextGraph): boolean {
  if (!card || !card.generatedAt) return true;
  const s = staleness(card, mod, graph);
  if (s.surfaceChanged || s.brokenCites.length) return true;
  return s.changedFiles.length > Math.max(1, mod.files.length) * REGEN_CHANGE_RATIO;
}

/** Small internal edits: accept the card as still true and record the new hashes. */
export function refreshCardHashes(card: ModuleCard, mod: ModuleNode, graph: ContextGraph): ModuleCard {
  return {
    ...card,
    sources: Object.fromEntries(mod.files.map((f) => [f, graph.files[f]!.hash])),
    surfaceHash: mod.surfaceHash,
    refreshedAt: new Date().toISOString(),
  };
}

/** A freshly generated draft, keeping the old card's decisions and human notes. */
export function mergeCard(old: ModuleCard | null, draft: CardDraft, mod: ModuleNode, graph: ContextGraph): ModuleCard {
  return {
    id: mod.id,
    ...draft,
    decisions: old?.decisions ?? [],
    rejected: old?.rejected ?? [],
    humanNotes: old?.humanNotes ?? '',
    sources: Object.fromEntries(mod.files.map((f) => [f, graph.files[f]!.hash])),
    surfaceHash: mod.surfaceHash,
    generatedAt: new Date().toISOString(),
    generatedAtSha: graph.indexedSha,
  };
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const CARD_INSTRUCTIONS = `You write a "module card": a short, exact briefing that lets another coding agent work in this module without exploring it.
Return ONLY a JSON object, no prose, no code fence:
{"purpose": "1-2 sentences: what this module is for and its role in the repo",
 "entryPoints": [{"text": "...", "cite": ["path#symbol"]}],
 "invariants": [...], "gotchas": [...], "howToChange": [...]}
Rules:
- Every item cites at least one location as "path#symbol" (preferred) or "path:line", using only files and symbols listed below.
- Only state what the code shows. No guesses, no generic advice ("write tests", "follow conventions").
- entryPoints: where callers come in (exported functions, routes, commands, components).
- invariants: rules the code relies on that a change must keep (ordering, ownership, security checks, file formats).
- gotchas: non-obvious behaviour that would trip someone up.
- howToChange: the concrete steps for the most likely changes (e.g. "add a route: …, register in …").
- 2-5 items per list when the code supports them, each under 30 words. Leave a list empty only when the code really has nothing to say there.
- Human notes are authoritative; never contradict them.`;

/** Compact model input: module facts, signatures, then as much source as the budget allows (most-used files first). */
export function buildCardPrompt(mod: ModuleNode, graph: ContextGraph, readFile: (rel: string) => string | null, opts: { maxTokens?: number; humanNotes?: string; rejected?: string[] } = {}): string {
  const budget = (opts.maxTokens ?? CARD_PROMPT_TOKENS) * 4;
  const out: string[] = [CARD_INSTRUCTIONS, '', `# Module ${mod.id} (\`${mod.dir || '.'}/\`, ${mod.files.length} files)`];
  const top = (rec: Record<string, number>) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, w]) => `${id}(${w})`)
      .join(', ');
  if (Object.keys(mod.deps).length) out.push(`Depends on: ${top(mod.deps)}`);
  if (Object.keys(mod.dependents).length) out.push(`Used by: ${top(mod.dependents)}`);
  if (mod.surface.length) out.push(`Used from outside: ${mod.surface.slice(0, 30).join(', ')}`);
  if (mod.tests.length) out.push(`Tests: ${mod.tests.slice(0, 10).join(', ')}`);
  if (opts.humanNotes?.trim()) out.push('', '## Human notes (authoritative)', opts.humanNotes.trim());
  if (opts.rejected?.length) out.push('', '## Claims a human marked wrong (do not repeat them)', ...opts.rejected.slice(-15).map((r) => `- ${r}`));

  out.push('', '## Symbols');
  for (const f of mod.files) {
    const node = graph.files[f]!;
    const ext = node.external.length ? `  uses: ${node.external.slice(0, 6).join(', ')}` : '';
    out.push(`${f} (${node.lines} lines)${ext}`);
    for (const s of node.symbols.slice(0, 40)) out.push(`  L${s.line} ${s.exported ? '' : '(local) '}${s.signature}`);
  }

  // Source: files used from outside first, then smaller ones; skip non-code text.
  const surfaceHits = new Map<string, number>();
  for (const e of mod.surface) {
    const f = e.split('#')[0]!;
    surfaceHits.set(f, (surfaceHits.get(f) ?? 0) + 1);
  }
  const order = mod.files
    .filter((f) => graph.files[f]!.lang !== 'other' && !graph.files[f]!.isTest)
    .sort((a, b) => (surfaceHits.get(b) ?? 0) - (surfaceHits.get(a) ?? 0) || graph.files[a]!.size - graph.files[b]!.size || a.localeCompare(b));
  out.push('', '## Source (line-numbered, may be trimmed)');
  let used = out.join('\n').length;
  for (const f of order) {
    if (used >= budget) break;
    const text = readFile(f);
    if (text === null) continue;
    const numbered = text
      .split('\n')
      .map((l, i) => `${i + 1}| ${l}`)
      .join('\n');
    const room = budget - used - f.length - 20;
    if (room < 400) break;
    const chunk = numbered.length > room ? numbered.slice(0, room) + '\n…(trimmed)' : numbered;
    out.push(`--- ${f}`, chunk);
    used += chunk.length + f.length + 8;
  }
  return out.join('\n');
}

export function parseCardResponse(text: string): CardDraft {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Card response had no JSON object');
  const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const list = (v: unknown): Claim[] =>
    Array.isArray(v)
      ? v.flatMap((x) => {
          const o = x as { text?: unknown; cite?: unknown };
          if (typeof o?.text !== 'string' || !o.text.trim()) return [];
          const cite = (Array.isArray(o.cite) ? o.cite : typeof o.cite === 'string' ? [o.cite] : []).filter((c): c is string => typeof c === 'string');
          return [{ text: o.text.trim(), cite }];
        })
      : [];
  return {
    purpose: typeof json.purpose === 'string' ? json.purpose.trim() : '',
    entryPoints: list(json.entryPoints).slice(0, 6),
    invariants: list(json.invariants).slice(0, 6),
    gotchas: list(json.gotchas).slice(0, 6),
    howToChange: list(json.howToChange).slice(0, 6),
  };
}

/** Prompt → model → parsed, citation-checked card. */
export async function generateCard(
  root: string,
  mod: ModuleNode,
  graph: ContextGraph,
  generator: CardGenerator,
  readFile: (rel: string) => string | null,
  opts: { signal?: AbortSignal } = {},
): Promise<{ card: ModuleCard; dropped: number }> {
  const old = loadCard(root, mod.id);
  const prompt = buildCardPrompt(mod, graph, readFile, { humanNotes: old?.humanNotes, rejected: old?.rejected });
  const raw = await generator.generate(prompt, opts);
  const { draft, dropped } = validateCitations(parseCardResponse(raw), graph);
  return { card: mergeCard(old, draft, mod, graph), dropped };
}

// ── Default generator ───────────────────────────────────────────────────────

/** Tokens and time of one card run, for the ledger. */
export interface CardRunUsage {
  model: string;
  startedAt: string;
  durationMs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ok: boolean;
}

/** Card writer on the Claude Agent SDK: no tools, no settings, small budget, Haiku by default. */
export class ClaudeCardGenerator implements CardGenerator {
  constructor(
    private readonly opts: { cwd: string; model?: string; maxBudgetUsd?: number; onCost?: (usd: number, usage: CardRunUsage) => void } = { cwd: process.cwd() },
  ) {}

  async generate(prompt: string, { signal }: { signal?: AbortSignal } = {}): Promise<string> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    const model = this.opts.model ?? CARD_MODEL;
    const startedAt = new Date();
    signal?.addEventListener('abort', onAbort, { once: true });
    const q = query({
      prompt,
      options: {
        cwd: this.opts.cwd,
        model,
        maxBudgetUsd: this.opts.maxBudgetUsd ?? 0.05,
        maxTurns: 1,
        abortController,
        tools: [],
        settingSources: [],
        persistSession: false,
        // A card is a summary of code it's given: extended thinking only adds time and cost.
        thinking: { type: 'disabled' },
        systemPrompt: 'You summarise source code into exact, cited JSON. Output JSON only.',
      },
    });
    let text = '';
    try {
      for await (const msg of q) {
        if (msg.type === 'result') {
          const u = (msg.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
          this.opts.onCost?.(msg.total_cost_usd ?? 0, {
            model,
            startedAt: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            input: u.input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            ok: msg.subtype === 'success',
          });
          if (msg.subtype === 'success') text = msg.result;
          else throw new Error(`Card generation failed: ${msg.subtype}`);
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    return text;
  }
}
