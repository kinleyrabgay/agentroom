import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  ContextAsk,
  ContextDocFileId,
  ContextDocPreview,
  ContextTour,
  LedgerEntry,
  Settings,
} from '../../shared/types/index.js';
import { gitUser } from '../../core/git.js';
import {
  askSystemPrompt,
  buildTour,
  changedSections,
  citedModules,
  contextPaths,
  diffLines,
  docSections,
  DOC_FILES,
  extractCitations,
  grepIndexed,
  isUnsure,
  mergeDoc,
  readIndexed,
  stripLinkTargets,
  tidyAnswer,
  type ContextGraph,
  type ContextReader,
  type DocInput,
  type ModuleCard,
} from '../../core/context/index.js';
import type { HostToolDef } from '../providers/provider.js';
import { contextTools } from '../agents/tools/context.tools.js';

/** In-process MCP server name for the Ask bot's tools. */
export const ASK_MCP_SERVER = 'agentroom-ask';
/** Most an Ask may spend. */
export const ASK_MAX_USD = 0.3;
const ASK_MAX_TURNS = 16;
/** Questions kept on disk (per machine, newest first). */
const HISTORY_MAX = 100;
const QUESTION_MAX = 2000;

export interface AnswerResult {
  text: string;
  ok: boolean;
  error?: string;
  costUsd: number;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
  tools: Record<string, number>;
  startedAt: string;
  durationMs: number;
}

/** Answers one question with read-only tools. Swapped in tests. */
export interface Answerer {
  answer(input: { question: string; system: string; tools: HostToolDef[]; model: string; maxBudgetUsd: number; signal?: AbortSignal }): Promise<AnswerResult>;
}

export interface KnowledgeDeps {
  root: string;
  reader: ContextReader;
  settings: () => Settings;
  record?: (row: Omit<LedgerEntry, 'id'>) => void;
  dayRemaining?: () => number | undefined;
  /** Notes on a module (pins). */
  setNotes: (id: string, text: string) => void;
  answerer?: Answerer;
  /** Who's asking (git user); tests override. */
  user?: () => string;
  ledgerId: string;
}

interface TourFile {
  people: Record<string, { done: string[]; current: string | null }>;
}

/**
 * The human side of the context map: ask the codebase (cited answers), generated docs, and an
 * onboarding tour. Everything reads the same graph and cards bots use.
 */
export class KnowledgeService {
  private running = 0;

  constructor(private readonly deps: KnowledgeDeps) {}

  private user(): string {
    return this.deps.user?.() ?? gitUser(this.deps.root);
  }

  private graph(): ContextGraph {
    const g = this.deps.reader.current();
    if (!g) throw new Error('No repo context yet. Build the map first.');
    return g;
  }

  private cards(g: ContextGraph): Record<string, ModuleCard | null> {
    return Object.fromEntries(Object.keys(g.modules).map((id) => [id, this.deps.reader.card(id)]));
  }

  // ── Ask ───────────────────────────────────────────────────────────────────

  /** Read-only tools: the context tools, plus grep and read over indexed files only. */
  askTools(): HostToolDef[] {
    const reader = this.deps.reader;
    const root = this.deps.root;
    return [
      ...contextTools(reader),
      {
        name: 'code_grep',
        description: 'Search the indexed source files (regex, or literal if it does not compile; case-insensitive unless it has capitals). Returns path:line: text.',
        schema: { pattern: z.string().min(1), path: z.string().optional().describe('Limit to a folder or file'), limit: z.number().int().min(1).max(60).optional() },
        handler: async ({ pattern, path: p, limit }) => {
          const g = reader.current();
          if (!g) return 'No repo context yet.';
          const hits = grepIndexed(root, g, pattern, { path: p, limit });
          return hits.length ? hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n') : 'No matches.';
        },
      },
      {
        name: 'code_read',
        description: 'Read lines of an indexed source file, numbered. Use start/end to read a range (at most 220 lines).',
        schema: { path: z.string().min(1), start: z.number().int().min(1).optional(), end: z.number().int().min(1).optional() },
        handler: async ({ path: p, start, end }) => {
          const g = reader.current();
          if (!g) return 'No repo context yet.';
          return readIndexed(root, g, p, start ?? 1, end);
        },
      },
    ];
  }

  async ask(question: string, opts: { signal?: AbortSignal } = {}): Promise<ContextAsk> {
    const q = String(question ?? '').trim().slice(0, QUESTION_MAX);
    if (!q) throw new Error('Ask a question.');
    const g = this.graph();
    const left = this.deps.dayRemaining?.();
    if (left !== undefined && left < 0.05) throw new Error("Today's budget is used up. Raise it in Settings → Budgets.");
    if (this.running >= 2) throw new Error('Two questions are already being answered. Try again in a moment.');
    const model = this.deps.settings().context.cardModel;
    const answerer = this.deps.answerer ?? new ClaudeAnswerer(this.deps.root);
    this.running++;
    let r: AnswerResult;
    try {
      r = await answerer.answer({ question: q, system: askSystemPrompt(this.deps.reader.overview()), tools: this.askTools(), model, maxBudgetUsd: Math.min(ASK_MAX_USD, left ?? ASK_MAX_USD), signal: opts.signal });
    } finally {
      this.running--;
    }
    this.deps.record?.({
      ts: new Date().toISOString(),
      startedAt: r.startedAt,
      botId: this.deps.ledgerId,
      model: r.model,
      ok: r.ok,
      costUsd: r.costUsd,
      input: r.input,
      output: r.output,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite,
      durationMs: r.durationMs,
      turns: r.turns,
      skills: [],
      tools: r.tools,
      ...(r.error ? { error: r.error } : {}),
    });
    const text = r.ok ? tidyAnswer(stripLinkTargets(r.text)).trim() : '';
    const cites = r.ok ? extractCitations(text, g) : [];
    const item: ContextAsk = {
      id: randomUUID().slice(0, 8),
      question: q,
      answer: text,
      cites,
      modules: citedModules(cites),
      unsure: r.ok ? isUnsure(r.text, cites) : true,
      ok: r.ok,
      ...(r.error ? { error: r.error } : {}),
      model: r.model,
      costUsd: Math.round(r.costUsd * 10000) / 10000,
      durationMs: r.durationMs,
      askedAt: new Date().toISOString(),
      by: this.user(),
    };
    this.saveHistory([item, ...this.allHistory()]);
    return item;
  }

  private historyFile() {
    return path.join(contextPaths(this.deps.root).runsDir, 'asks.json');
  }

  private allHistory(): ContextAsk[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.historyFile(), 'utf8')) as { items?: ContextAsk[] };
      return Array.isArray(v.items) ? v.items : [];
    } catch {
      return [];
    }
  }

  private saveHistory(items: ContextAsk[]) {
    fs.mkdirSync(path.dirname(this.historyFile()), { recursive: true });
    fs.writeFileSync(this.historyFile(), JSON.stringify({ items: items.slice(0, HISTORY_MAX) }, null, 2));
  }

  /** This person's questions, newest first. */
  history(): ContextAsk[] {
    const me = this.user();
    return this.allHistory().filter((a) => a.by === me);
  }

  deleteAsk(id: string): ContextAsk[] {
    const me = this.user();
    this.saveHistory(this.allHistory().filter((a) => !(a.id === id && a.by === me)));
    return this.history();
  }

  /** Adds the answer to a module's notes (rules bots follow), so the team and bots keep it. */
  pin(askId: string, moduleId: string): ContextAsk {
    const all = this.allHistory();
    const item = all.find((a) => a.id === askId && a.by === this.user());
    if (!item) throw new Error('That question is gone.');
    if (!item.ok || !item.answer) throw new Error('Only answered questions can be pinned.');
    const g = this.graph();
    if (!g.modules[moduleId]) throw new Error(`No module "${moduleId}".`);
    const card = this.deps.reader.card(moduleId);
    const short = summarise(item.answer);
    const cites = item.cites.filter((c) => c.ok && c.moduleId === moduleId).slice(0, 3).map((c) => `\`${c.file}${c.line ? `:${c.line}` : ''}\``);
    const note = `- **${item.question.replace(/\s+/g, ' ').slice(0, 160)}** ${short}${cites.length ? ` (${cites.join(', ')})` : ''} _(Ask, ${item.askedAt.slice(0, 10)})_`;
    const prev = card?.humanNotes?.trim() ?? '';
    this.deps.setNotes(moduleId, prev ? `${prev}\n${note}` : note);
    const next = { ...item, pinnedTo: moduleId };
    this.saveHistory(all.map((a) => (a.id === askId ? next : a)));
    return next;
  }

  // ── Docs ──────────────────────────────────────────────────────────────────

  private docInput(): DocInput {
    const g = this.graph();
    return { graph: g, cards: this.cards(g), repoName: path.basename(path.resolve(this.deps.root)) };
  }

  private docPath(id: ContextDocFileId) {
    return path.join(this.deps.root, DOC_FILES[id]);
  }

  private readDoc(id: ContextDocFileId): string | null {
    try {
      return fs.readFileSync(this.docPath(id), 'utf8');
    } catch {
      return null;
    }
  }

  /** What Write would change, per doc, without touching disk. */
  docsPreview(only?: string[]): ContextDocPreview[] {
    const input = this.docInput();
    return (Object.keys(DOC_FILES) as ContextDocFileId[]).map((id) => {
      const existing = this.readDoc(id);
      const sections = docSections(id, input);
      const changed = changedSections(existing, sections);
      const next = mergeDoc(id, existing, sections, only);
      const diff = diffLines(existing ?? '', next);
      return {
        id,
        path: DOC_FILES[id],
        exists: existing !== null,
        sections: sections.map((s) => ({ id: s.id, title: s.title, changed: changed.has(s.id) })),
        diff,
        added: diff.filter((l) => l.kind === 'add').length,
        removed: diff.filter((l) => l.kind === 'del').length,
      };
    });
  }

  /** Writes one doc (only the chosen sections when given). Never runs without a human click. */
  writeDoc(id: ContextDocFileId, only?: string[]): ContextDocPreview {
    if (!(id in DOC_FILES)) throw new Error(`Unknown doc "${id}".`);
    const input = this.docInput();
    const sections = docSections(id, input);
    if (only?.some((s) => !sections.some((x) => x.id === s))) throw new Error('Unknown section.');
    const next = mergeDoc(id, this.readDoc(id), sections, only);
    const file = this.docPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
    return this.docsPreview().find((p) => p.id === id)!;
  }

  // ── Tour ──────────────────────────────────────────────────────────────────

  private tourFile() {
    return path.join(contextPaths(this.deps.root).runsDir, 'tour.json');
  }

  private readTour(): TourFile {
    try {
      const v = JSON.parse(fs.readFileSync(this.tourFile(), 'utf8')) as TourFile;
      return v && typeof v.people === 'object' ? v : { people: {} };
    } catch {
      return { people: {} };
    }
  }

  tour(): ContextTour {
    const g = this.graph();
    const steps = buildTour(g, this.cards(g));
    const mine = this.readTour().people[this.user()] ?? { done: [], current: null };
    const ids = new Set(steps.map((s) => s.moduleId));
    return { steps, done: mine.done.filter((d) => ids.has(d)), current: mine.current && ids.has(mine.current) ? mine.current : null };
  }

  /** Marks a step done / not done and remembers where this person is. */
  tourProgress(patch: { done?: Record<string, boolean>; current?: string | null; reset?: boolean }): ContextTour {
    const file = this.readTour();
    const me = this.user();
    const mine = patch.reset ? { done: [], current: null } : (file.people[me] ?? { done: [], current: null });
    const done = new Set(mine.done);
    for (const [id, on] of Object.entries(patch.done ?? {})) on ? done.add(id) : done.delete(id);
    file.people[me] = { done: [...done], current: patch.current !== undefined ? patch.current : mine.current };
    fs.mkdirSync(path.dirname(this.tourFile()), { recursive: true });
    fs.writeFileSync(this.tourFile(), JSON.stringify(file, null, 2));
    return this.tour();
  }
}

/** The answer's first sentence or two, for a note. */
function summarise(answer: string): string {
  const para =
    answer
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#')) ?? answer;
  const flat = para.replace(/^[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
  return flat.length > 420 ? flat.slice(0, 419) + '…' : flat;
}

/** Answers on the Claude Agent SDK with only the Ask tools (no shell, no writes, no built-in file tools). */
export class ClaudeAnswerer implements Answerer {
  constructor(private readonly cwd: string) {}

  async answer({ question, system, tools, model, maxBudgetUsd, signal }: Parameters<Answerer['answer']>[0]): Promise<AnswerResult> {
    const { createSdkMcpServer, query, tool } = await import('@anthropic-ai/claude-agent-sdk');
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const startedAt = new Date();
    const names = tools.map((t) => `mcp__${ASK_MCP_SERVER}__${t.name}`);
    const counts: Record<string, number> = {};
    const server = createSdkMcpServer({
      name: ASK_MCP_SERVER,
      version: '1',
      tools: tools.map((t) =>
        tool(t.name, t.description, t.schema, async (args) => {
          counts[t.name] = (counts[t.name] ?? 0) + 1;
          try {
            return { content: [{ type: 'text' as const, text: await t.handler(args) }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
          }
        }),
      ),
    });
    const base: AnswerResult = { text: '', ok: false, costUsd: 0, model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, tools: counts, startedAt: startedAt.toISOString(), durationMs: 0 };
    try {
      const q = query({
        prompt: question,
        options: {
          cwd: this.cwd,
          model,
          maxBudgetUsd: Math.max(0.01, maxBudgetUsd),
          maxTurns: ASK_MAX_TURNS,
          abortController,
          // No built-in tools at all: reads go through code_read/code_grep, which only see indexed files.
          tools: [],
          mcpServers: { [ASK_MCP_SERVER]: server },
          strictMcpConfig: true,
          allowedTools: names,
          settingSources: [],
          persistSession: false,
          thinking: { type: 'disabled' },
          systemPrompt: system,
          canUseTool: async (name, input) =>
            names.includes(name) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Ask is read-only: only the context and code tools are available.' },
        },
      });
      for await (const msg of q) {
        if (msg.type !== 'result') continue;
        const u = (msg.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        base.costUsd = msg.total_cost_usd ?? 0;
        base.input = u.input_tokens ?? 0;
        base.output = u.output_tokens ?? 0;
        base.cacheRead = u.cache_read_input_tokens ?? 0;
        base.cacheWrite = u.cache_creation_input_tokens ?? 0;
        base.turns = msg.num_turns ?? 0;
        if (msg.subtype === 'success') {
          base.text = msg.result;
          base.ok = true;
        } else base.error = msg.subtype === 'error_max_budget_usd' ? 'Stopped at the spending limit for one question.' : msg.subtype === 'error_max_turns' ? 'Took too many steps. Try a narrower question.' : `Failed: ${msg.subtype}`;
      }
    } catch (err) {
      base.error = abortController.signal.aborted ? 'Cancelled.' : (err as Error).message;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    base.durationMs = Date.now() - startedAt.getTime();
    return base;
  }
}
