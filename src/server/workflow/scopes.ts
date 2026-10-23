/** Anything with a file scope (a task). */
type Scoped = { files?: readonly string[] };

/** A task's file scope as a path prefix: `./src/auth/**` → `src/auth`. Case-insensitive. */
export function normalizeScope(scope: string): string {
  let s = scope.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const glob = s.search(/[*?[{]/);
  if (glob >= 0) s = s.slice(0, glob);
  return s.replace(/\/+$/, '').toLowerCase();
}

/** Two scopes overlap when one is the other or contains it (on `/` boundaries). An empty scope is the whole repo. */
export function scopesOverlap(a: string, b: string): boolean {
  const x = normalizeScope(a);
  const y = normalizeScope(b);
  if (!x || !y || x === y) return true;
  return x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/** Tasks may build side by side only when both declare files and none of them overlap. */
export function tasksConflict(a: Scoped, b: Scoped): boolean {
  if (!a.files?.length || !b.files?.length) return true;
  return a.files.some((x) => b.files!.some((y) => scopesOverlap(x, y)));
}

/**
 * Pick the tasks to build together: the first ready task always, then later ready tasks that conflict
 * with none already picked, up to `slots`. A task that declares no files builds alone.
 */
export function pickBatch<T extends Scoped>(ready: T[], slots: number): T[] {
  const batch: T[] = [];
  for (const t of ready) {
    if (batch.length >= slots) break;
    if (batch.every((b) => !tasksConflict(b, t))) batch.push(t);
    if (batch[0] === t && !t.files?.length) break;
  }
  return batch;
}
