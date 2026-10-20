import type { GoalSource, IssueSourceId } from '../../../shared/types/index.js';

/** One issue, the same shape whatever tracker it came from. */
export interface SourceIssue {
  source: IssueSourceId;
  /** Id the source's own APIs use. */
  id: string;
  /** What people type: "ENG-123", "WEB-4X", "#45". */
  ref: string;
  title: string;
  url?: string;
  /** Column / state / status name. */
  state: string;
}

/**
 * Where work comes from (GitHub board, Sentry, Linear, Jira). Pages, triggers, hand-offs and chat
 * intake (Teams) all talk to sources through this, so a new tracker is one adapter.
 * Writes are optional: a source that can't move or comment simply leaves them out.
 */
export interface IssueSource {
  id: IssueSourceId;
  label: string;
  /** Connected and configured on this machine. */
  ready(): boolean;
  /** Open issues with their state names (for triggers). */
  list(): Promise<SourceIssue[]>;
  /** True when `ref` looks like one of this source's references ("ENG-12" for team ENG). */
  matches(ref: string): boolean;
  /** Find one issue by its reference, or null. */
  find(ref: string): Promise<SourceIssue | null>;
  /** Hand issues to a bot: the lead starts a goal, any other bot gets the brief. */
  handoff(input: { ids: string[]; botId?: string; note?: string }): Promise<{ botId: string; goal?: { id: string } }>;
  /** Move an issue to a state (tracker writes; only from explicit actions or rules the human turned on). */
  transition?(id: string, state: string): Promise<void>;
  comment?(id: string, body: string): Promise<void>;
}

/** All sources, looked up by id or by the reference someone typed. */
export class IssueSources {
  private readonly sources = new Map<IssueSourceId, IssueSource>();

  add(source: IssueSource) {
    this.sources.set(source.id, source);
    return this;
  }

  get(id: IssueSourceId): IssueSource | undefined {
    return this.sources.get(id);
  }

  list(): IssueSource[] {
    return [...this.sources.values()];
  }

  /** The first ready source that recognises the reference and can find it. */
  async resolve(ref: string): Promise<SourceIssue | null> {
    for (const s of this.list()) {
      if (!s.ready() || !s.matches(ref)) continue;
      const hit = await s.find(ref).catch(() => null);
      if (hit) return hit;
    }
    return null;
  }
}

/** References in free text: "ENG-123", "WEB-4X", "#45" (deduplicated, in order). */
export function issueRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\w/-])([A-Z][A-Z0-9]{1,9}-[A-Z0-9]{1,8})(?![\w-])/g)) out.add(m[1]!);
  for (const m of text.matchAll(/(?<![\w&])#(\d{1,7})\b/g)) out.add(`#${m[1]}`);
  return [...out];
}

/** The source reference a goal came from, for display ("ENG-123"). */
export function sourceRef(s: GoalSource): string {
  if (s.type === 'github') return s.number !== undefined ? `#${s.number}` : s.title;
  if (s.type === 'sentry') return s.shortId;
  return s.key;
}
