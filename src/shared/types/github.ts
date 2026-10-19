import type { GithubContentType } from '../enums.js';
import type { Goal } from './task.js';

/** One column = one option of the project's Status field. */
export interface GithubColumn {
  id: string;
  name: string;
  color?: string;
}

/**
 * `.agentroom/github/project.json` — committed, so the whole team shares the board setup.
 * Columns are configuration: cached here and re-synced only on demand, on an unknown status, or daily.
 */
export interface GithubProjectConfig {
  url: string;
  owner: string;
  ownerType: 'org' | 'user';
  number: number;
  title: string;
  projectId: string;
  statusField: { id: string; name: string };
  columns: GithubColumn[];
  /** Column ids the user chose to hide. */
  hiddenColumns: string[];
  columnsSyncedAt: string;
}

export interface GithubUser {
  login: string;
  avatarUrl: string;
}

export interface GithubLabel {
  name: string;
  color: string;
}

export interface GithubLinkedPr {
  number: number;
  url: string;
  state: string;
  title?: string;
}

/** A card on the project board. */
export interface GithubItem {
  /** Project item id (PVTI_…). */
  id: string;
  /** Issue / PR node id, used for assignee mutations. */
  contentId?: string;
  type: GithubContentType;
  /** owner/name */
  repo?: string;
  number?: number;
  title: string;
  url?: string;
  /** OPEN | CLOSED | MERGED */
  state?: string;
  /** Status option id; null when the card has no status. */
  statusId: string | null;
  priority?: string;
  iteration?: string;
  labels: GithubLabel[];
  assignees: GithubUser[];
  linkedPrs: GithubLinkedPr[];
  updatedAt: string;
}

/** GET /api/github/items */
export interface GithubBoard {
  project: GithubProjectConfig;
  items: GithubItem[];
  viewer: GithubUser | null;
  fetchedAt: number;
  /** Set when this is cached data because the latest refresh failed. */
  stale?: { reason: string };
}

export interface GithubComment {
  author: string;
  body: string;
  createdAt: string;
}

/** GET /api/github/items/:id — loaded lazily when a card opens. */
export interface GithubItemDetail {
  item: GithubItem;
  body: string;
  comments: GithubComment[];
}

/** POST /api/github/handoff — give cards to a bot. The lead bot starts a goal run; others get a direct message. */
export interface HandoffInput {
  itemIds: string[];
  /** Target bot; defaults to the Team Lead. */
  botId?: string;
  note?: string;
  /** Repo-relative paths the bots should read (e.g. specs, notes). */
  files?: string[];
  /** PR links, docs, designs… */
  links?: string[];
}

export interface HandoffResult {
  botId: string;
  /** Present when the hand-off started a goal run. */
  goal?: Goal;
}

/** Where a goal came from: GitHub cards or Sentry issues handed to the team. */
export type GoalSource =
  | {
      type: 'github';
      itemId: string;
      url?: string;
      number?: number;
      repo?: string;
      title: string;
    }
  | {
      type: 'sentry';
      /** Sentry issue id. */
      itemId: string;
      /** e.g. "WEB-1A2". */
      shortId: string;
      url?: string;
      project?: string;
      title: string;
    };
