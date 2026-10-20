import type { TrackerIssue, TrackerIssueDetail, TrackerIssueFilters, TrackerScope, TrackerState } from '../../../shared/types/index.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class TrackerError extends Error {
  constructor(
    message: string,
    /** The credentials were rejected (show the connect form again). */
    readonly auth = false,
  ) {
    super(message);
  }
}

/** What AgentRoom needs from Linear or Jira. `scope` is the Linear team id / Jira project key. */
export interface TrackerClient {
  viewer(): Promise<{ name: string; email?: string }>;
  scopes(): Promise<TrackerScope[]>;
  states(scope: string): Promise<TrackerState[]>;
  issues(scope: string, filters?: TrackerIssueFilters, extraFilter?: string): Promise<TrackerIssue[]>;
  /** By id or key ("ENG-123"). */
  issue(idOrKey: string): Promise<TrackerIssueDetail>;
  moveTo(idOrKey: string, stateName: string, scope: string): Promise<void>;
  comment(idOrKey: string, body: string): Promise<void>;
}
