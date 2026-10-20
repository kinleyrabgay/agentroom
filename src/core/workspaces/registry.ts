import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceRepo, WorkspaceView } from '../../shared/types/index.js';
import { gitBranch } from '../git.js';
import { Project } from '../project.js';
import { slugify } from '../slug.js';
import { primaryOf, type WorkspaceConfig } from './workspaces.js';

/** A repo the server works with: id, display name, folder, and whether it hosts the team. */
export interface RepoRef {
  id: string;
  name: string;
  root: string;
  primary: boolean;
}

/**
 * The projects one server works with. In single-project mode (the default) it holds just the
 * project; in a workspace it holds every repo of the workspace. The primary project hosts the team, board,
 * settings, budgets and approvals; the others contribute code, worktrees, PRs and context.
 *
 * Code that only knows "the project" keeps using `primary`; code that works per repo asks the
 * registry instead of threading paths around.
 */
export class ProjectRegistry {
  readonly primary: Project;
  /** Workspace name, or null in single-project mode. */
  readonly workspaceName: string | null;
  private readonly refs: RepoRef[];
  private readonly projects = new Map<string, Project>();

  private constructor(primary: Project, refs: RepoRef[], workspaceName: string | null) {
    this.primary = primary;
    this.refs = refs;
    this.workspaceName = workspaceName;
    this.projects.set(refs.find((r) => r.primary)!.id, primary);
  }

  /** Single-project mode: one repo, no workspace. */
  static single(project: Project): ProjectRegistry {
    const id = slugify(path.basename(project.root), 'repo');
    return new ProjectRegistry(project, [{ id, name: path.basename(project.root), root: project.root, primary: true }], null);
  }

  /** A workspace: the primary repo's project hosts the team; the other repos are opened on demand. */
  static fromWorkspace(workspace: WorkspaceConfig, primary?: Project): ProjectRegistry {
    const host = primaryOf(workspace);
    const project = primary ?? new Project(host.path);
    if (path.resolve(project.root) !== path.resolve(host.path)) throw new Error(`The workspace's primary repo is ${host.path}, not ${project.root}.`);
    const refs = workspace.repos.map((r) => ({ id: r.id, name: path.basename(r.path), root: r.path, primary: r.id === host.id }));
    return new ProjectRegistry(project, refs, workspace.name);
  }

  get isWorkspace(): boolean {
    return this.workspaceName !== null;
  }

  get primaryId(): string {
    return this.refs.find((r) => r.primary)!.id;
  }

  list(): RepoRef[] {
    return this.refs.map((r) => ({ ...r }));
  }

  ids(): string[] {
    return this.refs.map((r) => r.id);
  }

  has(id: string | null | undefined): boolean {
    return !!id && this.refs.some((r) => r.id === id);
  }

  /**
   * The repo for an id; empty/undefined means the primary repo. Unknown ids throw (callers
   * validate input from bots and the API with this).
   */
  ref(id?: string | null): RepoRef {
    if (!id) return { ...this.refs.find((r) => r.primary)! };
    const r = this.refs.find((x) => x.id === id);
    if (!r) throw new Error(`Unknown repo "${id}"${this.isWorkspace ? ` (workspace repos: ${this.ids().join(', ')})` : ''}.`);
    return { ...r };
  }

  /** Normalise a repo id: the primary repo is stored as unset. */
  normalize(id?: string | null): string | undefined {
    if (!id) return undefined;
    const r = this.ref(id);
    return r.primary ? undefined : r.id;
  }

  root(id?: string | null): string {
    return this.ref(id).root;
  }

  /** The repo's own Project (its `.agentroom/`), opened on first use. */
  project(id?: string | null): Project {
    const r = this.ref(id);
    let p = this.projects.get(r.id);
    if (!p) {
      p = new Project(r.root);
      this.projects.set(r.id, p);
    }
    return p;
  }

  /** The repo a path is in (absolute paths), if any. */
  repoOfPath(abs: string): RepoRef | undefined {
    const p = path.resolve(abs);
    return this.refs.find((r) => p === r.root || p.startsWith(r.root + path.sep));
  }

  view(): WorkspaceView | null {
    if (!this.isWorkspace) return null;
    return {
      name: this.workspaceName!,
      repos: this.refs.map(
        (r): WorkspaceRepo => ({
          id: r.id,
          name: r.name,
          root: r.root,
          primary: r.primary,
          branch: fs.existsSync(r.root) ? gitBranch(r.root) : null,
          initialized: fs.existsSync(path.join(r.root, '.agentroom')),
        }),
      ),
    };
  }
}
