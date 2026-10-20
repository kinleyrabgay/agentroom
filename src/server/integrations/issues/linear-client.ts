import type { TrackerIssue, TrackerIssueDetail, TrackerIssueFilters, TrackerScope, TrackerState } from '../../../shared/types/index.js';
import { TrackerError, type FetchLike, type TrackerClient } from './tracker-client.js';

/** `AGENTROOM_LINEAR_API` points at a local mock (tests, screenshots); never set in normal use. */
const ENDPOINT = process.env.AGENTROOM_LINEAR_API || 'https://api.linear.app/graphql';
const PAGE = 100;

/** Linear state types → our categories. */
const CATEGORY: Record<string, TrackerState['category']> = {
  triage: 'backlog',
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'started',
  completed: 'done',
  canceled: 'canceled',
};

interface RawState {
  id: string;
  name: string;
  type: string;
  position: number;
}
interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel: string;
  updatedAt: string;
  state: RawState;
  assignee: { name: string; avatarUrl?: string | null } | null;
  labels: { nodes: { name: string }[] };
}

const ISSUE_FIELDS = `id identifier title url priority priorityLabel updatedAt
  state { id name type position }
  assignee { name avatarUrl }
  labels(first: 10) { nodes { name } }`;

/** Linear over GraphQL with a personal API key (Settings → Security & access → API keys). */
export class LinearClient implements TrackerClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new TrackerError(`Couldn't reach Linear: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new TrackerError('Linear rejected the API key. Create a new one in Linear → Settings → Security & access.', true);
    const json = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
    if (!res.ok || !json || json.errors?.length || !json.data) {
      const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      if (/authentication|api key/i.test(msg)) throw new TrackerError('Linear rejected the API key.', true);
      throw new TrackerError(`Linear: ${msg}`);
    }
    return json.data;
  }

  async viewer() {
    const d = await this.gql<{ viewer: { name: string; email: string } }>('query { viewer { name email } }');
    return { name: d.viewer.name, email: d.viewer.email };
  }

  async scopes(): Promise<TrackerScope[]> {
    const d = await this.gql<{ teams: { nodes: { id: string; key: string; name: string }[] } }>('query { teams(first: 100) { nodes { id key name } } }');
    return d.teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name }));
  }

  async states(teamId: string): Promise<TrackerState[]> {
    const d = await this.gql<{ workflowStates: { nodes: RawState[] } }>(
      'query($team: ID!) { workflowStates(first: 100, filter: { team: { id: { eq: $team } } }) { nodes { id name type position } } }',
      { team: teamId },
    );
    return d.workflowStates.nodes
      .sort((a, b) => order(a.type) - order(b.type) || a.position - b.position)
      .map(toState);
  }

  async issues(teamId: string, f: TrackerIssueFilters = {}): Promise<TrackerIssue[]> {
    const filter: Record<string, unknown> = { team: { id: { eq: teamId } } };
    if (!f.closed) filter.state = { type: { nin: ['completed', 'canceled'] } };
    if (f.states?.length) filter.state = { name: { in: f.states } };
    if (f.mine) filter.assignee = { isMe: { eq: true } };
    if (f.query?.trim()) filter.or = [{ title: { containsIgnoreCase: f.query.trim() } }, { description: { containsIgnoreCase: f.query.trim() } }];
    const d = await this.gql<{ issues: { nodes: RawIssue[] } }>(
      `query($filter: IssueFilter, $first: Int) { issues(filter: $filter, first: $first, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`,
      { filter, first: PAGE },
    );
    return d.issues.nodes.map(toIssue);
  }

  async issue(id: string): Promise<TrackerIssueDetail> {
    const d = await this.gql<{ issue: RawIssue & { description: string | null; comments: { nodes: { body: string; createdAt: string; user: { name: string } | null }[] } } }>(
      `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} description comments(first: 30) { nodes { body createdAt user { name } } } } }`,
      { id },
    );
    if (!d.issue) throw new TrackerError(`Linear issue ${id} not found.`);
    return {
      issue: toIssue(d.issue),
      description: d.issue.description ?? '',
      comments: d.issue.comments.nodes
        .map((c) => ({ author: c.user?.name ?? 'Linear', body: c.body, createdAt: c.createdAt }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  async moveTo(issueId: string, stateName: string, teamId: string): Promise<void> {
    const state = (await this.states(teamId)).find((s) => s.name.toLowerCase() === stateName.trim().toLowerCase());
    if (!state) throw new TrackerError(`Linear has no state "${stateName}" in this team.`);
    const d = await this.gql<{ issueUpdate: { success: boolean } }>('mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }', {
      id: issueId,
      state: state.id,
    });
    if (!d.issueUpdate.success) throw new TrackerError('Linear did not move the issue.');
  }

  async comment(issueId: string, body: string): Promise<void> {
    const d = await this.gql<{ commentCreate: { success: boolean } }>('mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }', {
      id: issueId,
      body,
    });
    if (!d.commentCreate.success) throw new TrackerError('Linear did not add the comment.');
  }
}

const ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];
const order = (type: string) => {
  const i = ORDER.indexOf(type);
  return i === -1 ? ORDER.length : i;
};

function toState(s: RawState): TrackerState {
  // Linear has no separate review type; "In Review" is a started state by name.
  const category = s.type === 'started' && /review/i.test(s.name) ? 'review' : (CATEGORY[s.type] ?? 'todo');
  return { id: s.id, name: s.name, category };
}

function toIssue(i: RawIssue): TrackerIssue {
  return {
    id: i.id,
    key: i.identifier,
    title: i.title,
    url: i.url,
    state: toState(i.state),
    ...(i.priority ? { priority: { value: i.priority, label: i.priorityLabel } } : {}),
    ...(i.assignee ? { assignee: { name: i.assignee.name, ...(i.assignee.avatarUrl ? { avatarUrl: i.assignee.avatarUrl } : {}) } } : {}),
    labels: i.labels.nodes.map((l) => l.name),
    updatedAt: i.updatedAt,
  };
}
