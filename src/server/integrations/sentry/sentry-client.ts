/** Minimal Sentry REST client (bearer token). Throws readable errors; never logs the token. */
export class SentryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SentryResponse<T> {
  data: T;
  /** Cursor for the next page (from the Link header), or null. */
  next: string | null;
}

const TIMEOUT_MS = 20_000;

export type Fetch = typeof fetch;

export class SentryClient {
  constructor(
    private readonly token: () => string | undefined,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async get<T>(base: string, path: string, params: Record<string, string | string[] | undefined> = {}): Promise<SentryResponse<T>> {
    const token = this.token();
    if (!token) throw new SentryApiError('No Sentry token set. Add SENTRY_ACCESS_TOKEN on the Sentry page.', 401);
    const url = new URL(path, base.replace(/\/+$/, '') + '/');
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === '') continue;
      for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new SentryApiError(`Can't reach Sentry at ${url.origin}: ${(err as Error).message}`, 0);
    }
    if (!res.ok) throw new SentryApiError(await errorMessage(res), res.status);
    return { data: (await res.json()) as T, next: nextCursor(res.headers.get('link')) };
  }
}

async function errorMessage(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { detail?: unknown };
    detail = typeof body.detail === 'string' ? body.detail : '';
  } catch {
    // not JSON
  }
  if (res.status === 401) return 'Sentry rejected the token (invalid or expired). Paste a new token.';
  if (res.status === 403) return `The Sentry token is missing a permission${detail ? `: ${detail}` : ''}. It needs org:read, project:read and event:read.`;
  if (res.status === 404) return detail || 'Not found in Sentry (check the organization and project).';
  if (res.status === 429) return 'Sentry rate limit reached. Try again in a minute.';
  return `Sentry error ${res.status}${detail ? `: ${detail}` : ''}`;
}

/** `<…>; rel="next"; results="true"; cursor="0:100:0"` → cursor, only when there are more results. */
export function nextCursor(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    if (!/results="true"/.test(part)) return null;
    return /cursor="([^"]+)"/.exec(part)?.[1] ?? null;
  }
  return null;
}
