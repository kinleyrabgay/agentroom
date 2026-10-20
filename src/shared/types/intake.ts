/**
 * Intake: work that arrives from outside AgentRoom — issue trackers (Linear, Jira), Microsoft Teams,
 * and pull requests to review. Everything a tracker or chat sends is untrusted text.
 */

/** Issue trackers that can hand work to the team (GitHub and Sentry have their own pages). */
export type TrackerId = 'linear' | 'jira';

/** Every source that can resolve an issue reference ("ENG-12", "WEB-4X", "#45"). */
export type IssueSourceId = 'github' | 'sentry' | TrackerId;

/** One workflow state of a tracker (Linear state, Jira status). */
export interface TrackerState {
  id: string;
  name: string;
  /** Normalised category, for ordering and tone. */
  category: 'backlog' | 'todo' | 'started' | 'review' | 'done' | 'canceled';
}

/** One issue as a card. */
export interface TrackerIssue {
  /** Tracker-internal id (Linear uuid, Jira numeric id). */
  id: string;
  /** Human key, e.g. "ENG-123" / "PROJ-7". */
  key: string;
  title: string;
  url: string;
  state: TrackerState;
  priority?: { value: number; label: string };
  assignee?: { name: string; avatarUrl?: string };
  labels: string[];
  /** Issue type (Jira: Bug/Story/Task). */
  type?: string;
  updatedAt: string;
}

export interface TrackerComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface TrackerIssueDetail {
  issue: TrackerIssue;
  /** Plain text / markdown body. */
  description: string;
  comments: TrackerComment[];
}

/** What the tracker should do when a goal from one of its issues moves on. Every write is opt-in. */
export interface TrackerSync {
  /** Move the issue to this state when its goal starts building (null = don't). */
  onStart: string | null;
  /** Move the issue to this state when the goal's PR opens (null = don't). */
  onPr: string | null;
  /** Comment the PR link on the issue. */
  commentPr: boolean;
}

/** Committed tracker setup: `.agentroom/integrations/<tracker>.json`. Credentials are local secrets. */
export interface TrackerConfig {
  tracker: TrackerId;
  /** Linear team id / Jira project key. */
  scopeId: string;
  /** Linear team key / Jira project key, for display. */
  scopeKey: string;
  scopeName: string;
  /** Jira only: the site, e.g. "acme.atlassian.net". */
  site?: string;
  /** Extra filter: Jira JQL appended with AND; unused for Linear. */
  filter?: string;
  sync: TrackerSync;
}

export interface TrackerStatus {
  tracker: TrackerId;
  /** Credentials stored on this machine. */
  hasToken: boolean;
  config: TrackerConfig | null;
  /** Who the credentials belong to (once checked). */
  viewer?: { name: string; email?: string };
}

/** A team (Linear) or project (Jira) to pick while connecting. */
export interface TrackerScope {
  id: string;
  key: string;
  name: string;
}

export interface TrackerIssueFilters {
  /** State names; empty = all open. */
  states?: string[];
  query?: string;
  mine?: boolean;
  /** Include done/canceled. */
  closed?: boolean;
}

export interface TrackerIssuesPage {
  issues: TrackerIssue[];
  states: TrackerState[];
  fetchedAt: string;
}

export interface TrackerHandoffInput {
  issueIds: string[];
  botId?: string;
  note?: string;
  files?: string[];
  links?: string[];
}

// ---------- Microsoft Teams ----------

/** members can start goals and ask for status; approvers can also approve plans and requests. */
export type TeamsRole = 'member' | 'approver';

export interface TeamsUser {
  /** Azure AD object id (from the outgoing webhook's `from.aadObjectId`). */
  id: string;
  name: string;
  /** Git identity used in the audit log, "Name <email>". */
  identity?: string;
  role: TeamsRole;
}

/** Committed Teams setup: `.agentroom/integrations/teams.json`. Secrets (HMAC key, workflow URL) are local. */
export interface TeamsConfig {
  enabled: boolean;
  users: TeamsUser[];
  /** Goals started from Teams stop after the plan (default true). */
  stopAfterPlan: boolean;
  /** Post updates for every goal, not just the ones started from Teams. */
  announceAll: boolean;
  /** Public base URL that forwards to this machine (named tunnel, reverse proxy); empty = the phone tunnel's. */
  publicUrl: string;
}

/** Someone who messaged the bot but isn't on the allow-list (shown in Settings so they can be added). */
export interface TeamsUnknownSender {
  id: string;
  name: string;
  at: string;
  text: string;
}

export interface TeamsStatus {
  config: TeamsConfig;
  /** HMAC security token of the outgoing webhook is stored. */
  hasSecret: boolean;
  /** Workflow (Power Automate) webhook URL for updates is stored. */
  hasWorkflow: boolean;
  /** The URL to paste into the outgoing webhook, or null when no public URL is available yet. */
  callbackUrl: string | null;
  /** Where the public URL comes from. */
  publicUrlSource: 'custom' | 'phone-tunnel' | 'none';
  unknown: TeamsUnknownSender[];
  /** Last inbound message (for the setup checklist). */
  lastInboundAt?: string;
}

// ---------- PR review from a link ----------

export type PrReviewState = 'preparing' | 'reviewing' | 'ready' | 'posted' | 'failed';
export type PrReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

export interface PrReviewComment {
  id: string;
  path: string;
  line: number;
  /** RIGHT = new code, LEFT = removed code. */
  side: 'RIGHT' | 'LEFT';
  body: string;
  severity: 'blocker' | 'major' | 'minor' | 'nit';
  /** Written by the bot or by the human. */
  author: 'bot' | 'human';
}

export interface PrReview {
  id: string;
  url: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  /** The PR description (untrusted; shown to the bot wrapped as data). */
  description?: string;
  /** Workspaces: the local repo the PR belongs to, when it isn't the primary one. */
  workspaceRepo?: string;
  /** Opened from a fork: commands from it run only after the human allows them. */
  fork: boolean;
  /** The human allowed running the PR's scripts and tests. */
  allowScripts: boolean;
  state: PrReviewState;
  botId: string;
  worktree?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Review body (markdown). */
  summary: string;
  /** What the bot suggests posting as. */
  suggestedEvent: PrReviewEvent;
  comments: PrReviewComment[];
  /** Notes the bot wrote about lines that aren't in the diff (kept in the summary on post). */
  general: string[];
  createdAt: string;
  updatedAt: string;
  postedAt?: string;
  postedEvent?: PrReviewEvent;
  postedBy?: string;
  error?: string;
}

/** One file of a PR's diff (for the review viewer). */
export interface PrReviewFile {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
  truncated: boolean;
}

export interface PrReviewDetail {
  review: PrReview;
  files: PrReviewFile[];
}
