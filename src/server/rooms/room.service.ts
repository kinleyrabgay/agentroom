import { inferCrossRepoEdges, type CrossRepoInput, type ProjectRegistry, type RepoRef } from '../../core/rooms/index.js';
import { readIndexable } from '../../core/context/index.js';
import type { Project } from '../../core/project.js';
import type { CrossRepoEdge, Goal, RoomGraphRepo, RoomGraphView, RoomView } from '../../shared/types/index.js';
import type { ContextService } from '../context/context.service.js';

export interface RoomServiceDeps {
  registry: ProjectRegistry;
  /** The primary repo's context (the one the server always has). */
  primaryContext: ContextService;
  /** Context for another repo of the room, created on first use. */
  makeContext: (repo: RepoRef, project: Project) => ContextService;
}

/** Most of another repo's INDEX.md that goes into bots' instructions. */
const OTHER_INDEX_CHARS = 2400;
/** Cross-repo edges listed in bots' instructions. */
const PROMPT_EDGES = 12;

/**
 * The room as a whole: its repos, a context service per repo, the merged map with edges between
 * repos, and the room block in bots' instructions. In single-project mode it's a thin pass-through
 * to the primary context.
 */
export class RoomService {
  private readonly contexts = new Map<string, ContextService>();
  private edgeCache: { key: string; edges: CrossRepoEdge[] } | null = null;

  constructor(private readonly deps: RoomServiceDeps) {
    this.contexts.set(deps.registry.primaryId, deps.primaryContext);
  }

  get registry(): ProjectRegistry {
    return this.deps.registry;
  }

  get isRoom(): boolean {
    return this.deps.registry.isRoom;
  }

  view(): RoomView | null {
    return this.deps.registry.view();
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
    if (!this.isRoom) return;
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

  graph(): RoomGraphView {
    const repos: RoomGraphRepo[] = this.deps.registry.list().map((r) => {
      const c = this.context(r.id);
      const built = !!c.reader.current();
      const g = built ? c.graph() : { modules: [], edges: [] };
      return { id: r.id, name: r.name, primary: r.primary, built, modules: g.modules, edges: g.edges };
    });
    return { repos, crossEdges: this.crossEdges() };
  }

  /** Edges between repos; recomputed only when a repo's graph changed. */
  crossEdges(): CrossRepoEdge[] {
    if (!this.isRoom) return [];
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
   * The room block in every bot's instructions: the repos and their folders, how they connect,
   * and a short map of the other repos (the primary repo's map is already there). Stable across
   * runs so it stays in the prompt cache.
   */
  promptBlock(): string {
    if (!this.isRoom) return '';
    const reg = this.deps.registry;
    const lines = [
      `## Room "${reg.roomName}": ${reg.list().length} repos worked on together`,
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
      lines.push(`### How the repos connect`);
      for (const e of edges.slice(0, PROMPT_EDGES)) lines.push(`- ${e.fromRepo}:${e.from} → ${e.toRepo}:${e.to} (${e.kind}, ${e.weight}×; e.g. ${e.evidence[0]?.detail ?? ''})`);
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
