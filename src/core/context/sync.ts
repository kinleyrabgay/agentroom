import { emptyCard, generateCard, listCardIds, loadCard, needsRegeneration, refreshCardHashes, saveCard, staleness } from './cards.js';
import { buildGraph, changedSince, loadGraph, saveGraph, updateGraph } from './graph.js';
import { writeIndex } from './index-md.js';
import { readIndexable } from './scan.js';
import type { CardGenerator, ContextGraph } from './types.js';

export type SyncPhase = 'graph' | 'cards' | 'index' | 'done';

export interface SyncProgress {
  phase: SyncPhase;
  message: string;
  done?: number;
  total?: number;
  moduleId?: string;
}

export interface SyncOptions {
  /** Writes module cards. Without one, only facts and the index update and stale cards are reported. */
  generator?: CardGenerator | null;
  /** Re-index every file instead of only what changed since the last sync. */
  full?: boolean;
  /** Regenerate only these modules' cards (still re-indexes facts). */
  only?: string[];
  /** Cap on cards written in one sync (cost control). */
  maxCards?: number;
  concurrency?: number;
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
}

export interface SyncSummary {
  indexedSha: string | null;
  files: number;
  modules: number;
  /** Modules added, removed, or whose files changed. */
  modulesChanged: string[];
  cardsRegenerated: string[];
  /** Cards whose hashes were refreshed after small internal edits. */
  cardsRefreshed: string[];
  cardsFailed: { id: string; error: string }[];
  /** Cards still out of date after this sync (no generator, capped, or failed). */
  stale: string[];
  /** Modules without a card. */
  missing: string[];
  /** Cards for modules that no longer exist (kept: they may hold human notes). */
  orphaned: string[];
  citationsDropped: number;
  tokensIndex: number;
  incremental: boolean;
  durationMs: number;
}

const running = new Map<string, Promise<SyncSummary>>();

/** One sync per repo at a time; a second call while one runs gets the same result. */
export function syncContext(root: string, opts: SyncOptions = {}): Promise<SyncSummary> {
  const existing = running.get(root);
  if (existing) return existing;
  const p = doSync(root, opts).finally(() => running.delete(root));
  running.set(root, p);
  return p;
}

export function isSyncing(root: string): boolean {
  return running.has(root);
}

async function doSync(root: string, opts: SyncOptions): Promise<SyncSummary> {
  const started = Date.now();
  const progress = (p: SyncProgress) => opts.onProgress?.(p);

  progress({ phase: 'graph', message: 'Indexing files' });
  const prev = loadGraph(root);
  const changed = !opts.full && prev ? changedSince(root, prev.indexedSha) : null;
  const graph: ContextGraph = prev && changed ? updateGraph(root, prev, changed) : buildGraph(root, { prev });
  saveGraph(root, graph);

  const modulesChanged = Object.values(graph.modules)
    .filter((m) => prev?.modules[m.id]?.contentHash !== m.contentHash)
    .map((m) => m.id);
  for (const id of Object.keys(prev?.modules ?? {})) if (!graph.modules[id]) modulesChanged.push(id);

  // Cards: regenerate, refresh hashes, or report.
  const regen: string[] = [];
  const cardsRefreshed: string[] = [];
  const missing: string[] = [];
  for (const mod of Object.values(graph.modules)) {
    const card = loadCard(root, mod.id);
    const forced = opts.only?.includes(mod.id);
    if (forced || needsRegeneration(card, mod, graph)) {
      if (!opts.only || forced) regen.push(mod.id);
      if (!card?.generatedAt) missing.push(mod.id);
    } else if (card && staleness(card, mod, graph).stale) {
      saveCard(root, refreshCardHashes(card, mod, graph), mod);
      cardsRefreshed.push(mod.id);
    }
  }

  const cardsRegenerated: string[] = [];
  const cardsFailed: { id: string; error: string }[] = [];
  let citationsDropped = 0;
  const queue = opts.generator ? regen.slice(0, opts.maxCards ?? Infinity) : [];
  if (queue.length) {
    const total = queue.length;
    let done = 0;
    progress({ phase: 'cards', message: `Writing ${total} module card${total === 1 ? '' : 's'}`, done, total });
    const read = (rel: string) => readIndexable(root, rel);
    const worker = async () => {
      while (queue.length && !opts.signal?.aborted) {
        const id = queue.shift()!;
        const mod = graph.modules[id]!;
        try {
          const { card, dropped } = await generateCard(root, mod, graph, opts.generator!, read, { signal: opts.signal });
          saveCard(root, card, mod);
          citationsDropped += dropped;
          cardsRegenerated.push(id);
        } catch (e) {
          cardsFailed.push({ id, error: (e as Error).message });
        }
        done++;
        progress({ phase: 'cards', message: id, done, total, moduleId: id });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));
  }

  progress({ phase: 'index', message: 'Writing INDEX.md' });
  const purposes: Record<string, string> = {};
  const stale: string[] = [];
  for (const mod of Object.values(graph.modules)) {
    const card = loadCard(root, mod.id);
    if (card?.purpose) purposes[mod.id] = card.purpose;
    if (card?.generatedAt && staleness(card, mod, graph).stale) stale.push(mod.id);
  }
  const { tokens } = writeIndex(root, graph, purposes);
  const orphaned = listCardIds(root).filter((id) => !graph.modules[id]);

  const summary: SyncSummary = {
    indexedSha: graph.indexedSha,
    files: Object.keys(graph.files).length,
    modules: Object.keys(graph.modules).length,
    modulesChanged: modulesChanged.sort(),
    cardsRegenerated: cardsRegenerated.sort(),
    cardsRefreshed: cardsRefreshed.sort(),
    cardsFailed,
    stale: stale.sort(),
    missing: missing.filter((id) => !cardsRegenerated.includes(id)).sort(),
    orphaned,
    citationsDropped,
    tokensIndex: tokens,
    incremental: !!(prev && changed),
    durationMs: Date.now() - started,
  };
  progress({ phase: 'done', message: 'Context up to date' });
  return summary;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Records why something changed in a module. Decisions survive every regeneration. */
export function appendDecision(root: string, moduleId: string, text: string, date = today()): void {
  const line = `${date} · ${text.replace(/\s+/g, ' ').trim()}`;
  if (!text.trim()) return;
  const card = loadCard(root, moduleId) ?? emptyCard(moduleId);
  if (card.decisions.some((d) => d.slice(13) === line.slice(13))) return;
  saveCard(root, { ...card, decisions: [...card.decisions, line] }, loadGraph(root)?.modules[moduleId]);
}

/** Replaces the human-authored notes (kept verbatim, fed to the card writer as authoritative). */
export function setHumanNotes(root: string, moduleId: string, text: string): void {
  const card = loadCard(root, moduleId) ?? emptyCard(moduleId);
  saveCard(root, { ...card, humanNotes: text.replace(/\s+$/, '') }, loadGraph(root)?.modules[moduleId]);
}

export type ClaimSection = 'entryPoints' | 'invariants' | 'gotchas' | 'howToChange';
export const CLAIM_SECTIONS: readonly ClaimSection[] = ['entryPoints', 'invariants', 'gotchas', 'howToChange'];

/**
 * A human says a claim is wrong: drop it and remember why, so the next card written for this module
 * doesn't repeat it. Returns the removed claim's text, or null when there was nothing at that index.
 */
export function rejectClaim(root: string, moduleId: string, section: ClaimSection, index: number, reason: string): string | null {
  const card = loadCard(root, moduleId);
  const claim = card?.[section][index];
  if (!card || !claim) return null;
  const why = reason.replace(/\s+/g, ' ').trim();
  const next = { ...card, [section]: card[section].filter((_, i) => i !== index), rejected: [...card.rejected, `${claim.text}${why ? ` — ${why}` : ''}`].slice(-30) };
  saveCard(root, next, loadGraph(root)?.modules[moduleId]);
  return claim.text;
}

/** Replaces the decision log (the human edited or removed lines). */
export function setDecisions(root: string, moduleId: string, decisions: string[]): void {
  const card = loadCard(root, moduleId) ?? emptyCard(moduleId);
  const clean = decisions.map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean);
  saveCard(root, { ...card, decisions: clean }, loadGraph(root)?.modules[moduleId]);
}
