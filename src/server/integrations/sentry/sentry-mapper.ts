import type { SentryBreadcrumb, SentryEvent, SentryException, SentryFrame, SentryIssue, SentryTag } from '../../../shared/types/index.js';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Hours of the sparkline. */
const STATS_POINTS = 24;
const CONTEXT_MAX = 11;
const BREADCRUMBS_MAX = 50;

/** Sentry's issue JSON → what the UI needs. Tolerant of missing fields (self-hosted versions differ). */
export function toIssue(raw: unknown): SentryIssue {
  const r = obj(raw);
  const meta = obj(r.metadata);
  const project = obj(r.project);
  const assigned = obj(r.assignedTo);
  const stats = arr(obj(r.stats)['24h']).map((p) => num(arr(p)[1]));
  return {
    id: str(r.id) ?? '',
    shortId: str(r.shortId) ?? str(r.id) ?? '',
    title: str(r.title) ?? str(meta.title) ?? '(no title)',
    culprit: str(r.culprit) ?? '',
    permalink: str(r.permalink) ?? '',
    level: str(r.level) ?? 'error',
    status: str(r.status) ?? 'unresolved',
    ...(str(r.substatus) ? { substatus: str(r.substatus) } : {}),
    unhandled: r.isUnhandled === true,
    count: num(r.count),
    userCount: num(r.userCount),
    firstSeen: str(r.firstSeen) ?? '',
    lastSeen: str(r.lastSeen) ?? '',
    project: {
      id: str(project.id) ?? '',
      slug: str(project.slug) ?? '',
      name: str(project.name) ?? str(project.slug) ?? '',
      ...(str(project.platform) ? { platform: str(project.platform) } : {}),
    },
    ...(str(meta.type) ? { type: str(meta.type) } : {}),
    ...(str(meta.value) ? { value: str(meta.value) } : {}),
    ...(str(meta.filename) ? { filename: str(meta.filename) } : {}),
    ...(str(meta.function) ? { function: str(meta.function) } : {}),
    ...(str(assigned.name)
      ? { assignee: { type: assigned.type === 'team' ? ('team' as const) : ('user' as const), name: str(assigned.name)!, ...(str(assigned.email) ? { email: str(assigned.email) } : {}) } }
      : {}),
    ...(str(r.priority) ? { priority: str(r.priority) } : {}),
    stats: stats.slice(-STATS_POINTS),
    comments: num(r.numComments),
  };
}

function toFrame(raw: unknown): SentryFrame {
  const f = obj(raw);
  const context = arr(f.context)
    .map((c) => arr(c))
    .filter((c) => c.length >= 2)
    .map((c) => [num(c[0]), String(c[1] ?? '')] as [number, string])
    .slice(0, CONTEXT_MAX);
  return {
    filename: str(f.filename) ?? str(f.absPath) ?? str(f.module) ?? '<unknown>',
    ...(str(f.function) ? { function: str(f.function) } : {}),
    ...(str(f.module) ? { module: str(f.module) } : {}),
    ...(typeof f.lineNo === 'number' ? { lineNo: f.lineNo } : {}),
    ...(typeof f.colNo === 'number' ? { colNo: f.colNo } : {}),
    inApp: f.inApp === true,
    context,
  };
}

/** Readable one-liners from event.contexts (browser, os, runtime, device…). */
function contextLines(raw: unknown): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const [key, v] of Object.entries(obj(raw))) {
    const c = obj(v);
    const value = [str(c.name) ?? str(c.model), str(c.version)].filter(Boolean).join(' ');
    if (value && ['browser', 'os', 'runtime', 'device', 'client_os', 'app'].includes(key)) out.push({ name: key.replace(/_/g, ' '), value });
  }
  return out;
}

export function toEvent(raw: unknown): SentryEvent {
  const e = obj(raw);
  const tags = arr(e.tags)
    .map((t) => obj(t))
    .map((t) => ({ key: str(t.key) ?? '', value: str(t.value) ?? '' }))
    .filter((t) => t.key);
  const tag = (k: string) => tags.find((t) => t.key === k)?.value;
  const exceptions: SentryException[] = [];
  let breadcrumbs: SentryBreadcrumb[] = [];
  let request: SentryEvent['request'];
  let message = str(e.message);

  for (const entry of arr(e.entries).map(obj)) {
    const data = obj(entry.data);
    if (entry.type === 'exception') {
      for (const v of arr(data.values).map(obj)) {
        const mechanism = obj(v.mechanism);
        exceptions.push({
          type: str(v.type) ?? 'Error',
          value: str(v.value) ?? '',
          ...(typeof mechanism.handled === 'boolean' ? { handled: mechanism.handled } : {}),
          frames: arr(obj(v.stacktrace).frames).map(toFrame),
        });
      }
    } else if (entry.type === 'breadcrumbs') {
      breadcrumbs = arr(data.values)
        .map(obj)
        .slice(-BREADCRUMBS_MAX)
        .map((b) => ({
          ...(str(b.timestamp) ? { timestamp: str(b.timestamp) } : {}),
          ...(str(b.category) ? { category: str(b.category) } : {}),
          ...(str(b.message) ? { message: str(b.message) } : b.data ? { message: JSON.stringify(b.data).slice(0, 300) } : {}),
          ...(str(b.level) ? { level: str(b.level) } : {}),
          ...(str(b.type) ? { type: str(b.type) } : {}),
        }));
    } else if (entry.type === 'request') {
      request = { ...(str(data.url) ? { url: str(data.url) } : {}), ...(str(data.method) ? { method: str(data.method) } : {}) };
    } else if (entry.type === 'message' && !message) {
      message = str(data.formatted) ?? str(data.message);
    }
  }

  const user = obj(e.user);
  const release = str(obj(e.release).version) ?? str(e.release) ?? tag('release');
  return {
    id: str(e.eventID) ?? str(e.id) ?? '',
    ...(str(e.dateCreated) ? { dateCreated: str(e.dateCreated) } : {}),
    ...(message ? { message } : {}),
    ...(release ? { release } : {}),
    ...(tag('environment') ? { environment: tag('environment') } : {}),
    tags,
    exceptions,
    breadcrumbs,
    ...(request && (request.url || request.method) ? { request } : {}),
    contexts: contextLines(e.contexts),
    ...(Object.keys(user).length
      ? {
          user: {
            ...(str(user.id) ? { id: str(user.id) } : {}),
            ...(str(user.email) ? { email: str(user.email) } : {}),
            ...(str(user.ip_address) ? { ip: str(user.ip_address) } : {}),
            ...(str(user.username) ? { username: str(user.username) } : {}),
          },
        }
      : {}),
  };
}

export function toTags(raw: unknown): SentryTag[] {
  return arr(raw)
    .map(obj)
    .map((t) => ({
      key: str(t.key) ?? '',
      name: str(t.name) ?? str(t.key) ?? '',
      total: num(t.totalValues),
      top: arr(t.topValues)
        .map(obj)
        .slice(0, 5)
        .map((v) => ({ value: str(v.value) ?? str(v.name) ?? '', count: num(v.count) })),
    }))
    .filter((t) => t.key && t.top.length);
}
