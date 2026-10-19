import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';

/**
 * Start Claude Code with a prompt stream that never yields: no turn runs and no tokens are spent,
 * but the CLI answers control requests (usage, models, account). Always shut down afterwards.
 */
export async function withIdleSession<T>(cwd: string, timeoutMs: number, fn: (q: Query) => Promise<T>, extra: Partial<Options> = {}): Promise<T> {
  const abortController = new AbortController();
  const idle = (async function* () {
    await new Promise<void>((resolve) => abortController.signal.addEventListener('abort', () => resolve(), { once: true }));
  })() as AsyncIterable<never>;
  const q = query({ prompt: idle, options: { cwd, abortController, settingSources: [], tools: [], persistSession: false, ...extra } });
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fn(q);
  } finally {
    clearTimeout(timer);
    abortController.abort();
    try {
      q.close();
    } catch {
      // already closed
    }
  }
}
