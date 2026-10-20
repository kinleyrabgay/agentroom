import type { ContextModuleSummary } from './context.js';

/** Multi-repo workspaces: several repos, one team, one board, one context map. */

/** One repo in a workspace, as the API and UI see it. */
export interface WorkspaceRepo {
  /** Stable id within the workspace (slug of the folder name), used on tasks (`task.repo`) and in URLs. */
  id: string;
  name: string;
  root: string;
  /** The workspace's host repo: the team, board, settings and budgets live in its `.agentroom/`. */
  primary: boolean;
  /** Current branch of the human's working copy, null outside git. */
  branch: string | null;
  /** The repo has its own `.agentroom/` (context cards, local config). */
  initialized: boolean;
  /** Command that serves this repo's app, for QA. */
  devCommand?: string;
  /** URL of this repo's running app, for QA. */
  url?: string;
}

export interface WorkspaceView {
  name: string;
  repos: WorkspaceRepo[];
  /** The workspace file changed (repos added/removed, primary moved) since this server started: restart to apply. */
  restartNeeded?: boolean;
}

/** A saved workspace (Settings → Workspace). */
export interface WorkspaceSummary {
  name: string;
  primary: string;
  repos: { id: string; path: string; devCommand?: string; url?: string }[];
  /** This server runs it. */
  current: boolean;
}

/** Settings → Workspace: the saved workspaces and the command that starts one. */
export interface WorkspacesView {
  current: string | null;
  list: WorkspaceSummary[];
  /** Folder of the project this server runs (suggested first repo of a new workspace). */
  projectRoot: string;
}

/** How a cross-repo dependency was found (`manual`: added by a person). */
export type CrossRepoKind = 'http' | 'openapi' | 'graphql' | 'trpc' | 'package' | 'manual';

/** Guessed by AgentRoom, confirmed by a person, or added by a person. */
export type CrossRepoStatus = 'guessed' | 'confirmed' | 'manual';

export interface CrossRepoEvidence {
  /** Repo-relative file in the consumer. */
  file: string;
  line?: number;
  /** What matched, e.g. `GET /api/users/:id` or `@acme/shared`. */
  detail: string;
}

/** A module in one repo uses a module in another (consumer → provider). */
export interface CrossRepoEdge {
  fromRepo: string;
  from: string;
  toRepo: string;
  to: string;
  kind: CrossRepoKind;
  weight: number;
  /** A few examples of what matched (capped). */
  evidence: CrossRepoEvidence[];
  /** Stable key (kind + both ends), used to confirm or hide it. Set by the workspace service. */
  key?: string;
  /** Unset = guessed. */
  status?: CrossRepoStatus;
  /** Hidden by a person (only listed when asked for). */
  hidden?: boolean;
  /** Why a person added it (manual links). */
  note?: string;
}

/** People's decisions on cross-repo links, committed in the primary repo (`.agentroom/context/workspace-links.json`). */
export interface WorkspaceLinks {
  confirmed: string[];
  hidden: string[];
  manual: { fromRepo: string; from: string; toRepo: string; to: string; note?: string; by?: string; at?: string }[];
}

/** One repo's part of the workspace map. */
export interface WorkspaceGraphRepo {
  id: string;
  name: string;
  primary: boolean;
  /** The repo's fact graph exists. */
  built: boolean;
  modules: ContextModuleSummary[];
  edges: { from: string; to: string; weight: number }[];
}

/** The merged map: every repo's modules, plus the edges between repos. */
export interface WorkspaceGraphView {
  repos: WorkspaceGraphRepo[];
  crossEdges: CrossRepoEdge[];
}
