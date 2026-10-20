import fs from 'node:fs';
import path from 'node:path';
import { StateType } from '../../shared/enums.js';
import type {
  ContextClaim,
  ContextClaimSection,
  ContextFilePeek,
  ContextGraphView,
  ContextHit,
  ContextImpact,
  ContextIndexView,
  ContextModuleDetail,
  ContextModuleSummary,
  ContextProgress,
  ContextStatus,
  ContextSyncResult,
  Goal,
  LedgerEntry,
  Settings,
} from '../../shared/types/index.js';
import {
  appendDecision,
  CLAIM_SECTIONS,
  ClaudeCardGenerator,
  contextPaths,
  derivedPurpose,
  estimateTokens,
  isSyncing,
  parseCitation,
  readIndexable,
  rejectClaim,
  setDecisions,
  setHumanNotes,
  staleness,
  symbolLine,
  syncContext,
  ContextReader,
  type CardGenerator,
  type ContextGraph,
  type ModuleCard,
  type ModuleNode,
  type SyncSummary,
} from '../../core/context/index.js';
import type { Hub } from '../realtime/hub.js';

/** Measured on Haiku 4.5: ~6-8k tokens in, ~600 out, about two cents a card. */
const USD_PER_CARD = 0.02;
/** Wait this long after a goal finishes before syncing, so a burst of goals syncs once. */
export const AUTO_SYNC_DELAY_MS = 30_000;
/** Most lines one code peek returns. */
export const PEEK_MAX_LINES = 200;
/** Ledger rows for card writing use this bot id. */
export const CONTEXT_LEDGER_ID = 'context';

export interface ContextServiceDeps {
  root: string;
  hub?: Pick<Hub, 'state'>;
  settings: () => Settings;
  /** Records card-writing runs (budgets, insights). */
  record?: (row: Omit<LedgerEntry, 'id'>) => void;
  /** USD left today under the daily cap; undefined = no cap. */
  dayRemaining?: () => number | undefined;
  /** Swap the card writer (tests). */
  generator?: (model: string, onCost: (usd: number) => void) => CardGenerator;
  /** Tests shorten the debounce. */
  autoSyncDelayMs?: number;
}

export interface SyncRequest {
  /** Write cards (needs a model). False = only update the fact graph and INDEX.md. */
  cards?: boolean;
  full?: boolean;
  only?: string[];
}

/**
 * Repo context for the server: one reader for bots' tools and the UI, syncs (single flight, debounced
 * after goals), card writing on the ledger, and status pushed to the UI.
 */
export class ContextService {
  readonly reader: ContextReader;
  private progress: ContextProgress | null = null;
  private last: ContextSyncResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<SyncSummary> | null = null;
  private statusCache: ContextStatus | null = null;
  private statusAt = 0;

  constructor(private readonly deps: ContextServiceDeps) {
    this.reader = new ContextReader(deps.root);
  }

  enabled(): boolean {
    return this.deps.settings().context.enabled;
  }

  /** Fast facts-only update at startup (no model calls). */
  start(): void {
    if (!this.enabled()) return;
    void this.sync({ cards: false }).catch(() => {});
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  /** Runs a sync, or joins the one already running. */
  sync(req: SyncRequest = {}): Promise<SyncSummary> {
    if (this.current) return this.current;
    const settings = this.deps.settings().context;
    let costUsd = 0;
    let generator: CardGenerator | null = null;
    if (req.cards !== false) {
      const left = this.deps.dayRemaining?.();
      if (left !== undefined && left < 0.02) throw new Error("Today's budget is used up, so no cards were written. Raise it in Settings → Budgets.");
      generator = this.makeGenerator(settings.cardModel, (usd) => (costUsd += usd));
    }
    const started = Date.now();
    this.progress = { phase: 'graph', message: 'Indexing files' };
    this.push();
    const run = syncContext(this.deps.root, {
      generator,
      full: req.full,
      ...(req.only?.length ? { only: req.only } : {}),
      maxCards: req.only?.length ? req.only.length : settings.maxCardsPerSync,
      onProgress: (p) => {
        this.progress = p.phase === 'done' ? null : p;
        this.push();
      },
    });
    this.current = run
      .then((s) => {
        this.last = {
          at: new Date().toISOString(),
          ok: !s.cardsFailed.length,
          ...(s.cardsFailed.length ? { error: s.cardsFailed[0]!.error } : {}),
          cardsRegenerated: s.cardsRegenerated.length,
          cardsFailed: s.cardsFailed.length,
          modulesChanged: s.modulesChanged.length,
          durationMs: s.durationMs,
          costUsd: Math.round(costUsd * 10000) / 10000,
        };
        return s;
      })
      .catch((e: Error) => {
        this.last = { at: new Date().toISOString(), ok: false, error: e.message, cardsRegenerated: 0, cardsFailed: 0, modulesChanged: 0, durationMs: Date.now() - started, costUsd };
        throw e;
      })
      .finally(() => {
        this.current = null;
        this.progress = null;
        this.statusCache = null;
        this.push();
      });
    return this.current;
  }

  /** After a goal: debounce, then sync with cards (when auto sync is on). */
  scheduleAutoSync(): void {
    const s = this.deps.settings().context;
    if (!s.enabled || !s.autoSync) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync({ cards: true }).catch(() => {});
    }, this.deps.autoSyncDelayMs ?? AUTO_SYNC_DELAY_MS);
    this.timer.unref?.();
  }

  /** A goal finished: note it in the cards of the modules it touched, then sync later. */
  onGoalDone(goal: Pick<Goal, 'id' | 'title' | 'summary'>, files: string[]): string[] {
    if (!this.enabled()) return [];
    const graph = this.reader.current();
    const touched = new Set<string>();
    if (graph) for (const f of files) {
      const id = graph.fileModule[f] ?? this.ownerByDir(graph, f);
      if (id) touched.add(id);
    }
    const summary = firstSentence(goal.summary ?? '');
    const text = `${goal.id} ${goal.title}${summary ? `: ${summary}` : ''}`.slice(0, 220);
    for (const id of touched) appendDecision(this.deps.root, id, text);
    if (touched.size) this.statusCache = null;
    this.scheduleAutoSync();
    return [...touched].sort();
  }

  /** New files aren't in the graph yet: the module whose folder holds them. */
  private ownerByDir(graph: ContextGraph, file: string): string | undefined {
    let best: ModuleNode | undefined;
    for (const m of Object.values(graph.modules)) {
      if ((m.dir === '' || file.startsWith(m.dir + '/')) && (!best || m.dir.length > best.dir.length)) best = m;
    }
    return best?.id;
  }

  private makeGenerator(model: string, add: (usd: number) => void): CardGenerator {
    if (this.deps.generator) return this.deps.generator(model, add);
    return new ClaudeCardGenerator({
      cwd: this.deps.root,
      model,
      onCost: (usd, u) => {
        add(usd);
        this.deps.record?.({
          ts: new Date().toISOString(),
          startedAt: u.startedAt,
          botId: CONTEXT_LEDGER_ID,
          model: u.model,
          ok: u.ok,
          costUsd: usd,
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          durationMs: u.durationMs,
          turns: 1,
          skills: [],
          tools: {},
        });
      },
    });
  }

  // ── Read side ─────────────────────────────────────────────────────────────

  status(): ContextStatus {
    if (this.statusCache && !this.progress && Date.now() - this.statusAt < 3000) return { ...this.statusCache, syncing: isSyncing(this.deps.root), progress: this.progress, last: this.last };
    const g = this.reader.current();
    const cards = { fresh: 0, stale: 0, missing: 0 };
    if (g) for (const m of Object.values(g.modules)) cards[this.statusOf(m, g)]++;
    let tokensIndex = 0;
    try {
      tokensIndex = estimateTokens(fs.readFileSync(contextPaths(this.deps.root).index, 'utf8'));
    } catch {
      /* not built yet */
    }
    const s: ContextStatus = {
      enabled: this.enabled(),
      built: !!g,
      indexedSha: g?.indexedSha ?? null,
      indexedAt: g?.indexedAt ?? null,
      files: g ? Object.keys(g.files).length : 0,
      modules: g ? Object.keys(g.modules).length : 0,
      cards,
      tokensIndex,
      syncing: isSyncing(this.deps.root),
      progress: this.progress,
      last: this.last,
      estimateUsd: Math.round(cards.missing * USD_PER_CARD * 100) / 100,
    };
    if (!this.progress) {
      this.statusCache = s;
      this.statusAt = Date.now();
    }
    return s;
  }

  push(): void {
    this.deps.hub?.state({ type: StateType.Context, context: this.status() });
  }

  /** Card edited by hand (notes, decisions, rejected claims). */
  changed(): void {
    this.statusCache = null;
    this.push();
  }

  private statusOf(m: ModuleNode, g: ContextGraph): ContextModuleSummary['status'] {
    const card = this.reader.card(m.id);
    if (!card?.generatedAt) return 'missing';
    return staleness(card, m, g).stale ? 'stale' : 'fresh';
  }

  graph(): ContextGraphView {
    const g = this.need();
    return {
      modules: Object.values(g.modules)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => this.summary(m, g)),
      edges: g.edges.map((e) => ({ from: e.from, to: e.to, weight: e.weight })),
    };
  }

  private summary(m: ModuleNode, g: ContextGraph): ContextModuleSummary {
    const card = this.reader.card(m.id);
    return { id: m.id, dir: m.dir, files: m.files.length, tests: m.tests.length, purpose: card?.purpose || derivedPurpose(m, g), status: this.statusOf(m, g) };
  }

  module(target: string): ContextModuleDetail {
    const g = this.need();
    const m = this.reader.resolveModule(target);
    if (!m) throw new Error(`No module "${target}".`);
    const card: ModuleCard | null = this.reader.card(m.id);
    const st = card?.generatedAt ? staleness(card, m, g) : null;
    const claims = (list: ModuleCard['entryPoints']): ContextClaim[] =>
      list.map((c) => ({
        text: c.text,
        cite: c.cite.map((raw) => {
          const p = parseCitation(raw);
          const file = p?.file ?? raw;
          const line = p?.symbol ? (symbolLine(g, file, p.symbol) ?? undefined) : p?.line;
          const ok = !!g.files[file] && (!p?.symbol || line !== undefined || p.line !== undefined);
          return { raw, file, ...(line !== undefined ? { line } : {}), ok };
        }),
      }));
    const sections = Object.fromEntries(CLAIM_SECTIONS.map((k) => [k, card ? claims(card[k]) : []])) as Record<ContextClaimSection, ContextClaim[]>;
    const rel = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([id, weight]) => ({ id, weight }));
    return {
      ...this.summary(m, g),
      generatedAt: card?.generatedAt || null,
      generatedAtSha: card?.generatedAtSha ?? null,
      sections,
      decisions: card?.decisions ?? [],
      rejected: card?.rejected ?? [],
      humanNotes: card?.humanNotes ?? '',
      staleness: st?.stale ? { changedFiles: st.changedFiles, surfaceChanged: st.surfaceChanged, brokenCites: st.brokenCites } : null,
      fileFacts: m.files.map((f) => {
        const n = g.files[f]!;
        return { path: f, lines: n.lines, isTest: n.isTest, symbols: n.symbols.map((s) => ({ name: s.name, kind: s.kind, line: s.line, signature: s.signature, exported: s.exported })) };
      }),
      testFiles: m.tests,
      uses: rel(m.deps),
      usedBy: rel(m.dependents),
    };
  }

  /**
   * Lines of an indexed file for the code peek. Only files in the graph can be read, so paths
   * outside the repo, ignored files and secrets never come back.
   */
  peek(file: string, opts: { line?: number; start?: number; end?: number } = {}): ContextFilePeek {
    const g = this.need();
    const rel = path.posix.normalize(String(file).replace(/\\/g, '/').replace(/^\.\//, ''));
    if (rel.startsWith('..') || path.isAbsolute(rel) || !g.files[rel]) throw new Error(`Not an indexed file: ${file}`);
    const abs = path.resolve(this.deps.root, rel);
    if (!abs.startsWith(path.resolve(this.deps.root) + path.sep)) throw new Error(`Not an indexed file: ${file}`);
    const text = readIndexable(this.deps.root, rel);
    if (text === null) throw new Error(`Can't read ${rel}.`);
    const all = text.split('\n');
    const total = all.length;
    const focus = opts.line && opts.line >= 1 && opts.line <= total ? opts.line : undefined;
    let start = opts.start ?? (focus ? Math.max(1, focus - 30) : 1);
    let end = opts.end ?? start + 119;
    start = Math.max(1, Math.min(start, total));
    end = Math.max(start, Math.min(end, total, start + PEEK_MAX_LINES - 1));
    return { path: rel, moduleId: g.fileModule[rel] ?? null, start, end, total, lines: all.slice(start - 1, end), ...(focus ? { focus } : {}) };
  }

  search(q: string, limit = 20): ContextHit[] {
    this.need();
    return this.reader.search(q, Math.min(Math.max(1, limit), 50));
  }

  impact(files: string[]): ContextImpact {
    return this.reader.impactSet(files);
  }

  /** Every indexed file path (impact picker). */
  files(): string[] {
    return Object.keys(this.need().files);
  }

  index(): ContextIndexView {
    const text = this.reader.overview();
    return { text, tokens: estimateTokens(text) };
  }

  /** The block bots get in their instructions, or '' when context is off or not built. */
  promptBlock(): string {
    if (!this.enabled()) return '';
    try {
      return fs.readFileSync(contextPaths(this.deps.root).index, 'utf8').trim();
    } catch {
      return '';
    }
  }

  // ── Human feedback ────────────────────────────────────────────────────────

  setNotes(id: string, text: string): ContextModuleDetail {
    const m = this.mod(id);
    setHumanNotes(this.deps.root, m.id, String(text ?? '').slice(0, 8000));
    this.changed();
    return this.module(m.id);
  }

  reject(id: string, section: ContextClaimSection, index: number, reason: string): ContextModuleDetail {
    const m = this.mod(id);
    if (!CLAIM_SECTIONS.includes(section)) throw new Error(`Unknown section "${section}".`);
    if (!rejectClaim(this.deps.root, m.id, section, index, String(reason ?? '').slice(0, 500))) throw new Error('That claim no longer exists.');
    this.changed();
    return this.module(m.id);
  }

  setDecisions(id: string, decisions: string[]): ContextModuleDetail {
    const m = this.mod(id);
    if (!Array.isArray(decisions) || decisions.some((d) => typeof d !== 'string')) throw new Error('Send { decisions: string[] }.');
    setDecisions(this.deps.root, m.id, decisions.map((d) => d.slice(0, 500)));
    this.changed();
    return this.module(m.id);
  }

  private mod(id: string): ModuleNode {
    const g = this.need();
    const m = g.modules[id];
    if (!m) throw new Error(`No module "${id}".`);
    return m;
  }

  private need(): ContextGraph {
    const g = this.reader.current();
    if (!g) throw new Error('No repo context yet. Build it first.');
    return g;
  }
}

function firstSentence(s: string): string {
  const line = s
    .replace(/[#*_`>]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 10);
  if (!line) return '';
  const m = line.match(/^(.{20,160}?[.!?])(\s|$)/);
  return (m ? m[1]! : line.slice(0, 160)).trim();
}
