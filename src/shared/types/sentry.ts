/** Sentry setup for the repo: `.agentroom/sentry.json` (committed). The token is local: `${secret:SENTRY_ACCESS_TOKEN}`. */
export interface SentryConfig {
  /** https://sentry.io, or a self-hosted base URL. */
  host: string;
  org: string;
  orgName?: string;
  /** API base for the org's data region, e.g. https://de.sentry.io. */
  regionUrl?: string;
  /** Project slugs shown on the page; empty = every project in the org. */
  projects: string[];
  /** Default environment filter, e.g. "production". */
  environment?: string;
}

export interface SentryStatus {
  config: SentryConfig | null;
  /** SENTRY_ACCESS_TOKEN is set in local secrets. */
  hasToken: boolean;
  /** Workspaces: Sentry projects from the other repos' own `sentry.json` (same org), per repo. */
  repoProjects?: { repo: string; projects: string[] }[];
}

export interface SentryOrg {
  slug: string;
  name: string;
  regionUrl?: string;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform?: string;
}

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'sample';
export type SentryIssueStatus = 'unresolved' | 'resolved' | 'ignored' | 'reprocessing';

/** One issue (a group of similar events). */
export interface SentryIssue {
  id: string;
  /** e.g. "WEB-1A2". */
  shortId: string;
  title: string;
  /** Where it happened: function or transaction. */
  culprit: string;
  /** Link to the issue in Sentry. */
  permalink: string;
  level: SentryLevel | string;
  status: SentryIssueStatus | string;
  /** new | regressed | escalating | ongoing | archived_* … */
  substatus?: string;
  unhandled: boolean;
  /** Events in the selected period. */
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project: { id: string; slug: string; name: string; platform?: string };
  /** Workspaces: the repo whose Sentry projects this issue belongs to (unset = the primary repo). */
  repo?: string;
  /** Exception type and message, e.g. "TypeError" / "Cannot read properties of undefined". */
  type?: string;
  value?: string;
  filename?: string;
  function?: string;
  assignee?: { type: 'user' | 'team'; name: string; email?: string };
  priority?: 'high' | 'medium' | 'low' | string;
  /** Event counts per hour over the last 24 h (oldest first). */
  stats: number[];
  comments: number;
}

export type SentrySort = 'date' | 'new' | 'freq' | 'user';
export type SentryPeriod = '24h' | '7d' | '14d' | '30d' | '90d';

export interface SentryIssueQuery {
  /** Free text and Sentry search syntax, e.g. `TypeError browser.name:Chrome`. */
  query?: string;
  /** Project slugs; empty/absent = the configured projects. */
  projects?: string[];
  /** Workspaces: only this repo's projects. */
  repo?: string;
  environment?: string;
  status?: 'unresolved' | 'resolved' | 'ignored' | 'all';
  level?: SentryLevel;
  assigned?: 'me' | 'unassigned' | 'any';
  sort?: SentrySort;
  period?: SentryPeriod;
  cursor?: string;
}

export interface SentryIssuePage {
  issues: SentryIssue[];
  nextCursor: string | null;
  fetchedAt: string;
}

export interface SentryFrame {
  filename: string;
  function?: string;
  module?: string;
  lineNo?: number;
  colNo?: number;
  /** The app's own code (not a library). */
  inApp: boolean;
  /** Source lines around the frame: [line number, code]. */
  context: [number, string][];
}

export interface SentryException {
  type: string;
  value: string;
  handled?: boolean;
  /** Innermost frame last (Sentry's order). */
  frames: SentryFrame[];
}

export interface SentryBreadcrumb {
  timestamp?: string;
  category?: string;
  message?: string;
  level?: string;
  type?: string;
}

/** The most recent event of an issue: stack trace, breadcrumbs, tags. */
export interface SentryEvent {
  id: string;
  dateCreated?: string;
  message?: string;
  release?: string;
  environment?: string;
  tags: { key: string; value: string }[];
  exceptions: SentryException[];
  breadcrumbs: SentryBreadcrumb[];
  request?: { url?: string; method?: string };
  /** Readable context lines, e.g. { name: "Browser", value: "Chrome 141" }. */
  contexts: { name: string; value: string }[];
  user?: { id?: string; email?: string; ip?: string; username?: string };
}

export interface SentryTag {
  key: string;
  name: string;
  total: number;
  top: { value: string; count: number }[];
}

export interface SentryIssueDetail {
  issue: SentryIssue;
  event: SentryEvent | null;
  tags: SentryTag[];
}

export interface SentryHandoffInput {
  issueIds: string[];
  /** Target bot; defaults to the Team Lead (which starts a goal). */
  botId?: string;
  note?: string;
  files?: string[];
  links?: string[];
}
