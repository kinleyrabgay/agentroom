import path from 'node:path';
import {
  addRepos,
  createWorkspace,
  inferCrossRepoEdges,
  listWorkspaces,
  loadWorkspace,
  primaryOf,
  removeRepo,
  setPrimary,
  setRepoSettings,
  type CrossRepoInput,
  type ProjectRegistry,
  type RepoRef,
  type WorkspaceConfig,
} from '../../core/workspaces/index.js';
import { contextPaths, readIndexable } from '../../core/context/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';
import type { Project } from '../../core/project.js';
import type { CrossRepoEdge, Goal, WorkspaceGraphRepo, WorkspaceGraphView, WorkspaceLinks, WorkspaceView, WorkspacesView } from '../../shared/types/index.js';
import type { ContextService } from '../context/context.service.js';

export interface WorkspaceServiceDeps {
  registry: ProjectRegistry;
  /** The primary repo's context (the one the server always has). */
  primaryContext: ContextService;
  /** Context for another repo of the workspace, created on first use. */
  makeContext: (repo: RepoRef, project: Project) => ContextService;
}

/** Key of a cross-repo link: what was found, and both ends. */
export function linkKey(e: Pick<CrossRepoEdge, 'kind' | 'fromRepo' | 'from' | 'toRepo' | 'to'>): string {
  return [e.kind, e.fromRepo, e.from, e.toRepo, e.to].join('|');
}

const NO_LINKS: WorkspaceLinks = { confirmed: [], hidden: [], manual: [] };
const MAX_MANUAL_LINKS = 200;

/** Most of another repo's INDEX.md that goes into bots' instructions. */
const OTHER_INDEX_CHARS = 2400;
/** Cross-repo edges listed in bots' instructions. */
const PROMPT_EDGES = 12;

/**
 * The workspace as a whole: its repos, a context service per repo, the merged map with edges between
 * repos, and the workspace block in bots' instructions. In single-project mode it's a thin pass-through
 * to the primary context.
 */
export class WorkspaceService {
  private readonly contexts = new Map<string, ContextService>();
  private edgeCache: { key: string; edges: CrossRepoEdge[] } | null = null;

  constructor(private readonly deps: WorkspaceServiceDeps) {
    this.contexts.set(deps.registry.primaryId, deps.primaryContext);
  }

  get registry(): ProjectRegistry {
    return this.deps.registry;
  }

  get isWorkspace(): boolean {
    return this.deps.registry.isWorkspace;
  }

  view(): WorkspaceView | null {
    const v = this.deps.registry.view();
    if (!v) return null;
    const cfg = this.config();
    const byId = new Map((cfg?.repos ?? []).map((r) => [r.id, r]));
    return {
      ...v,
      repos: v.repos.map((r) => {
        const c = byId.get(r.id);
        return { ...r, ...(c?.devCommand ? { devCommand: c.devCommand } : {}), ...(c?.url ? { url: c.url } : {}) };
      }),
      ...(cfg && this.differs(cfg) ? { restartNeeded: true } : {}),
    };
  }

  /** The workspace file as it is now (it may have changed since start), or null in single-project mode. */
  config(): WorkspaceConfig | null {
    const name = this.deps.registry.workspaceName;
    if (!name) return null;
    try {
      return loadWorkspace(name);
    } catch {
      return null;
    }
  }

  /** Repos or primary changed on disk since this server started. */
  private differs(cfg: WorkspaceConfig): boolean {
    const reg = this.deps.registry;
    const now = cfg.repos.map((r) => `${r.id}=${path.resolve(r.path)}`).sort().join(',');
    const started = reg.list().map((r) => `${r.id}=${path.resolve(r.root)}`).sort().join(',');
    return now !== started || primaryOf(cfg).id !== reg.primaryId;
  }

  /** Dev command and URL of a repo's app (read live from the workspace file). */
  appOf(repoId: string): { devCommand?: string; url?: string } {
    const r = this.config()?.repos.find((x) => x.id === repoId);
    return { ...(r?.devCommand ? { devCommand: r.devCommand } : {}), ...(r?.url ? { url: r.url } : {}) };
  }

  // ── Settings → Workspace ───────────────────────────────────────────────

  /** Saved workspaces, which one runs here, and this project's folder. */
  workspaces(): WorkspacesView {
    const current = this.deps.registry.workspaceName;
    return {
      current,
      projectRoot: this.deps.registry.primary.root,
      list: listWorkspaces().map((w) => ({
        name: w.name,
        primary: primaryOf(w).id,
        current: w.name === current,
        repos: w.repos.map((r) => ({ id: r.id, path: r.path, ...(r.devCommand ? { devCommand: r.devCommand } : {}), ...(r.url ? { url: r.url } : {}) })),
      })),
    };
  }

  /** New workspace (applies after `agentroom start --workspace <name>`). */
  create(name: string, paths: string[], primary?: string): WorkspaceConfig {
    return createWorkspace(String(name ?? '').trim(), paths.map((p) => String(p).trim()).filter(Boolean), primary ? { primary } : {});
  }

  /** Edit a saved workspace (the running one by default). Repo list / primary changes apply after a restart. */
  edit(name: string | undefined, change: { add?: string; remove?: string; primary?: string; repo?: string; devCommand?: string; url?: string }): WorkspaceConfig {
    const target = name || this.deps.registry.workspaceName;
    if (!target) throw new Error('This server runs a single project. Create a workspace first.');
    if (change.add) return addRepos(target, [change.add]);
    if (change.remove) {
      if (target === this.deps.registry.workspaceName && change.remove === this.deps.registry.primaryId) throw new Error('That repo hosts the team of the running workspace. Make another repo primary (and restart) before removing it.');
      return removeRepo(target, change.remove);
    }
    if (change.primary) return setPrimary(target, change.primary);
    if (change.repo) return setRepoSettings(target, change.repo, { ...(change.devCommand !== undefined ? { devCommand: change.devCommand } : {}), ...(change.url !== undefined ? { url: change.url } : {}) });
    throw new Error('Nothing to change.');
  }

  // ── Cross-repo links: people confirm, hide or add them (committed in the primary repo) ──

  private linksFile(): string {
    return path.join(contextPaths(this.deps.registry.primary.root).dir, 'workspace-links.json');
  }

  links(): WorkspaceLinks {
    const raw = readJson<Partial<WorkspaceLinks>>(this.linksFile(), NO_LINKS);
    return {
      confirmed: Array.isArray(raw.confirmed) ? raw.confirmed.filter((k) => typeof k === 'string') : [],
      hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((k) => typeof k === 'string') : [],
      manual: Array.isArray(raw.manual) ? raw.manual.filter((m) => m && typeof m.fromRepo === 'string' && typeof m.from === 'string' && typeof m.toRepo === 'string' && typeof m.to === 'string') : [],
    };
  }

  private saveLinks(next: WorkspaceLinks) {
    const sorted = { confirmed: [...new Set(next.confirmed)].sort(), hidden: [...new Set(next.hidden)].sort(), manual: next.manual };
    writeJson(this.linksFile(), sorted);
  }

  /** Confirm, hide or reset (back to guessed) a link by key. */
  decideLink(key: string, action: 'confirm' | 'hide' | 'reset'): WorkspaceLinks {
    if (typeof key !== 'string' || key.split('|').length !== 5) throw new Error('Unknown link.');
    const l = this.links();
    const next: WorkspaceLinks = { ...l, confirmed: l.confirmed.filter((k) => k !== key), hidden: l.hidden.filter((k) => k !== key) };
    if (action === 'confirm') next.confirmed.push(key);
    else if (action === 'hide') next.hidden.push(key);
    else if (action !== 'reset') throw new Error('action must be confirm, hide or reset');
    this.saveLinks(next);
    return next;
  }

  /** Add a link AgentRoom missed: module `from` in `fromRepo` uses module `to` in `toRepo`. */
  addLink(input: { fromRepo?: string; from?: string; toRepo?: string; to?: string; note?: string }, by?: string): WorkspaceLinks {
    const reg = this.deps.registry;
    const fromRepo = reg.ref(String(input.fromRepo ?? '')).id;
    const toRepo = reg.ref(String(input.toRepo ?? '')).id;
    if (!input.fromRepo || !input.toRepo) throw new Error('Pick both repos.');
    if (fromRepo === toRepo) throw new Error('A cross-repo link joins two different repos.');
    const from = String(input.from ?? '');
    const to = String(input.to ?? '');
    for (const [repo, mod] of [[fromRepo, from], [toRepo, to]] as const) {
      const g = this.context(repo).reader.current();
      if (!g?.modules[mod]) throw new Error(`No module "${mod}" in ${repo}.`);
    }
    const l = this.links();
    const key = linkKey({ kind: 'manual', fromRepo, from, toRepo, to });
    if (l.manual.some((m) => linkKey({ kind: 'manual', ...m }) === key)) throw new Error('That link is already there.');
    if (l.manual.length >= MAX_MANUAL_LINKS) throw new Error(`At most ${MAX_MANUAL_LINKS} manual links.`);
    const note = String(input.note ?? '').trim().slice(0, 200);
    const next = { ...l, manual: [...l.manual, { fromRepo, from, toRepo, to, ...(note ? { note } : {}), ...(by ? { by } : {}), at: new Date().toISOString() }] };
    this.saveLinks(next);
    return next;
  }

  removeLink(key: string): WorkspaceLinks {
    const l = this.links();
    const manual = l.manual.filter((m) => linkKey({ kind: 'manual', ...m }) !== key);
    if (manual.length === l.manual.length) throw new Error('Unknown manual link.');
    const next = { ...l, manual, confirmed: l.confirmed.filter((k) => k !== key) };
    this.saveLinks(next);
    return next;
  }

  /** The context of a repo (unset = primary). Unknown ids throw. */
  context(repoId?: string | null): ContextService {
    const ref = this.deps.registry.ref(repoId);
    let c = this.contexts.get(ref.id);
    if (!c) {
      c = this.deps.makeContext(ref, this.deps.registry.project(ref.id));
      this.contexts.set(ref.id, c);
    }
    return c;
  }

  /** Facts-only sync of every other repo at startup (the primary starts on its own). */
  start(): void {
    if (!this.isWorkspace) return;
    for (const r of this.deps.registry.list()) if (!r.primary) this.context(r.id).start();
  }

  stop(): void {
    for (const [id, c] of this.contexts) if (id !== this.deps.registry.primaryId) c.stop();
  }

  /** Push every repo's status (tagged with the repo) to the UI. */
  push(): void {
    for (const id of this.contexts.keys()) this.contexts.get(id)!.push();
  }

  // ── Merged map ─────────────────────────────────────────────────────────

  graph(opts: { hidden?: boolean } = {}): WorkspaceGraphView {
    const repos: WorkspaceGraphRepo[] = this.deps.registry.list().map((r) => {
      const c = this.context(r.id);
      const built = !!c.reader.current();
      const g = built ? c.graph() : { modules: [], edges: [] };
      return { id: r.id, name: r.name, primary: r.primary, built, modules: g.modules, edges: g.edges };
    });
    return { repos, crossEdges: this.crossEdges(opts) };
  }

  /**
   * Edges between repos with people's decisions applied: confirmed and manual links first, then
   * guessed ones; hidden links only with `hidden: true` (so they can be un-hidden).
   */
  crossEdges(opts: { hidden?: boolean } = {}): CrossRepoEdge[] {
    if (!this.isWorkspace) return [];
    const l = this.links();
    const confirmed = new Set(l.confirmed);
    const hidden = new Set(l.hidden);
    const inferred = this.inferredEdges().map((e): CrossRepoEdge => {
      const key = linkKey(e);
      return { ...e, key, status: confirmed.has(key) ? 'confirmed' : 'guessed', ...(hidden.has(key) ? { hidden: true } : {}) };
    });
    const manual = l.manual.map(
      (m): CrossRepoEdge => ({
        fromRepo: m.fromRepo,
        from: m.from,
        toRepo: m.toRepo,
        to: m.to,
        kind: 'manual',
        weight: 1,
        evidence: [],
        key: linkKey({ kind: 'manual', ...m }),
        status: 'manual',
        ...(m.note ? { note: m.note } : {}),
      }),
    );
    const rank = (e: CrossRepoEdge) => (e.status === 'guessed' ? 1 : 0);
    return [...manual, ...inferred].filter((e) => opts.hidden || !e.hidden).sort((a, b) => rank(a) - rank(b) || b.weight - a.weight);
  }

  /** Edges found in the code; recomputed only when a repo's graph changed. */
  private inferredEdges(): CrossRepoEdge[] {
    const inputs: CrossRepoInput[] = [];
    const keys: string[] = [];
    for (const r of this.deps.registry.list()) {
      const graph = this.context(r.id).reader.current();
      keys.push(`${r.id}@${graph?.indexedAt ?? '-'}`);
      if (graph) inputs.push({ repo: r.id, graph, read: (rel) => readIndexable(r.root, rel) });
    }
    const key = keys.join('|');
    if (this.edgeCache?.key === key) return this.edgeCache.edges;
    const edges = inferCrossRepoEdges(inputs);
    this.edgeCache = { key, edges };
    return edges;
  }

  // ── Bots ───────────────────────────────────────────────────────────────

  /**
   * The workspace block in every bot's instructions: the repos and their folders, how they connect,
   * and a short map of the other repos (the primary repo's map is already there). Stable across
   * runs so it stays in the prompt cache.
   */
  promptBlock(): string {
    if (!this.isWorkspace) return '';
    const reg = this.deps.registry;
    const lines = [
      `## Workspace "${reg.workspaceName}": ${reg.list().length} repos worked on together`,
      `One team and one board span these repos. Paths are absolute.`,
      ...reg.list().map((r) => `- \`${r.id}\`${r.primary ? ' (primary: team, board, settings)' : ''}: ${r.root}`),
      `Every goal task names the repo it changes (\`repo\` on the task; unset = \`${reg.primaryId}\`). Change only that repo; read the others when you need to.`,
    ];
    let edges: CrossRepoEdge[] = [];
    try {
      edges = this.crossEdges();
    } catch {
      /* maps not built */
    }
    if (edges.length) {
      lines.push(`### How the repos connect`, `Confirmed links were checked by a person; guessed ones were inferred from the code, so verify them before relying on them.`);
      for (const e of edges.slice(0, PROMPT_EDGES)) {
        const label = e.status === 'guessed' ? 'guessed' : 'confirmed';
        const why = e.kind === 'manual' ? (e.note ? `; ${e.note}` : '') : `, ${e.weight}×; e.g. ${e.evidence[0]?.detail ?? ''}`;
        lines.push(`- ${e.fromRepo}:${e.from} → ${e.toRepo}:${e.to} (${label}, ${e.kind}${why})`);
      }
    }
    for (const r of reg.list()) {
      const app = this.appOf(r.id);
      if (app.devCommand || app.url) lines.push(`- App of \`${r.id}\`: ${[app.devCommand ? `start with \`${app.devCommand}\`` : '', app.url ? `open ${app.url}` : ''].filter(Boolean).join(', ')}`);
    }
    for (const r of reg.list()) {
      if (r.primary) continue;
      const block = this.context(r.id).promptBlock();
      if (!block) continue;
      const cut = block.length > OTHER_INDEX_CHARS ? `${block.slice(0, OTHER_INDEX_CHARS).replace(/\n[^\n]*$/, '')}\n…` : block;
      lines.push(`### Map of \`${r.id}\` (${r.root})`, cut);
    }
    return lines.join('\n');
  }

  /** A goal finished: note it on the touched modules of a non-primary repo and re-sync its map. */
  onGoalDone(repoId: string, goal: Pick<Goal, 'id' | 'title' | 'summary'>, files: string[]): void {
    if (!this.deps.registry.has(repoId) || repoId === this.deps.registry.primaryId) return;
    void this.context(repoId).onGoalDone(goal, files);
  }
}
