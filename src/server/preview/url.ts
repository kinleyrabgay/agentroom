/**
 * Resolve what a human or bot typed into a URL: absolute URLs, `host:port/path`,
 * or `/path` relative to the page that's open. Local hosts default to http, others to https.
 */
export function resolveUrl(raw: string, currentOrigin?: string): URL {
  const s = raw.trim();
  if (s.startsWith('/') && currentOrigin) return new URL(s, currentOrigin);
  if (/^https?:\/\//i.test(s)) return new URL(s);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[\w.-]+:\d+/.test(s)) throw new Error(`Unsupported URL scheme: ${s}`);
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(s);
  return new URL(`${local ? 'http' : 'https'}://${s}`);
}

/** Replace every occurrence of one origin with another. */
export function swapOrigin(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}
