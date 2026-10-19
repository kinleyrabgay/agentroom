import type { Context } from 'hono';

/** Run a handler; reply with its value as JSON, or `{ error }` with 400. */
export async function respond(c: Context, fn: () => unknown | Promise<unknown>) {
  try {
    const value = await fn();
    return c.json(value ?? { ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}

/** Parse a JSON body, tolerating an empty one. */
export async function body<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}
