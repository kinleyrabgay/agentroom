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
}

export interface WorkspaceView {
  name: string;
  repos: WorkspaceRepo[];
}

/** How a cross-repo dependency was found. */
export type CrossRepoKind = 'http' | 'openapi' | 'graphql' | 'trpc' | 'package';

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
