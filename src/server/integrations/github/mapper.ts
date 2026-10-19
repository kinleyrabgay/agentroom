import { GithubContentType } from '../../../shared/enums.js';
import type { GithubColumn, GithubComment, GithubItem } from '../../../shared/types/index.js';

// ---------- raw GraphQL shapes (only what we read) ----------

interface RawFieldRef { id?: string; name?: string }
export interface RawFieldValue {
  __typename: string;
  optionId?: string;
  name?: string;
  title?: string;
  field?: RawFieldRef;
}
interface RawNodes<T> { nodes: (T | null)[] }
export interface RawContent {
  __typename: string;
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  updatedAt?: string;
  repository?: { nameWithOwner: string };
  labels?: RawNodes<{ name: string; color: string }>;
  assignees?: RawNodes<{ login: string; avatarUrl: string }>;
  closedByPullRequestsReferences?: RawNodes<{ number: number; url: string; state: string; title?: string }>;
}
export interface RawItem {
  id: string;
  updatedAt?: string;
  fieldValues?: RawNodes<RawFieldValue>;
  content?: RawContent | null;
}
export interface RawSingleSelectField {
  id?: string;
  name?: string;
  options?: { id: string; name: string; color?: string }[];
}

const nodes = <T>(c: RawNodes<T> | undefined): T[] => (c?.nodes ?? []).filter((n): n is T => !!n);

/** The board's columns: the single-select field named "Status", else the first single-select field. */
export function pickStatusField(fields: RawSingleSelectField[]): { id: string; name: string; columns: GithubColumn[] } | null {
  const selects = fields.filter((f) => f?.id && Array.isArray(f.options));
  const field = selects.find((f) => f.name?.toLowerCase() === 'status') ?? selects[0];
  if (!field?.id) return null;
  return {
    id: field.id,
    name: field.name ?? 'Status',
    columns: (field.options ?? []).map((o) => ({ id: o.id, name: o.name, ...(o.color ? { color: o.color } : {}) })),
  };
}

const CONTENT_TYPES: Record<string, GithubItem['type']> = {
  Issue: GithubContentType.Issue,
  PullRequest: GithubContentType.PullRequest,
  DraftIssue: GithubContentType.DraftIssue,
};

/** Raw project item → board card. */
export function toItem(raw: RawItem, statusFieldId: string): GithubItem {
  const c = raw.content ?? { __typename: 'DraftIssue' };
  const values = nodes(raw.fieldValues);
  const status = values.find((v) => v.__typename === 'ProjectV2ItemFieldSingleSelectValue' && v.field?.id === statusFieldId);
  const priority = values.find((v) => v.__typename === 'ProjectV2ItemFieldSingleSelectValue' && /priority/i.test(v.field?.name ?? ''));
  const iteration = values.find((v) => v.__typename === 'ProjectV2ItemFieldIterationValue');
  return {
    id: raw.id,
    ...(c.id ? { contentId: c.id } : {}),
    type: CONTENT_TYPES[c.__typename] ?? GithubContentType.DraftIssue,
    ...(c.repository ? { repo: c.repository.nameWithOwner } : {}),
    ...(c.number !== undefined ? { number: c.number } : {}),
    title: c.title ?? '(untitled)',
    ...(c.url ? { url: c.url } : {}),
    ...(c.state ? { state: c.state } : {}),
    statusId: status?.optionId ?? null,
    ...(priority?.name ? { priority: priority.name } : {}),
    ...(iteration?.title ? { iteration: iteration.title } : {}),
    labels: nodes(c.labels).map((l) => ({ name: l.name, color: l.color })),
    assignees: nodes(c.assignees).map((a) => ({ login: a.login, avatarUrl: a.avatarUrl })),
    linkedPrs: nodes(c.closedByPullRequestsReferences).map((p) => ({ number: p.number, url: p.url, state: p.state, ...(p.title ? { title: p.title } : {}) })),
    updatedAt: c.updatedAt ?? raw.updatedAt ?? new Date(0).toISOString(),
  };
}

export function toComments(raw: { nodes?: ({ author?: { login: string } | null; body: string; createdAt: string } | null)[] } | undefined): GithubComment[] {
  return (raw?.nodes ?? [])
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => ({ author: n.author?.login ?? 'ghost', body: n.body, createdAt: n.createdAt }));
}
