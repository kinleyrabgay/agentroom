const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Merge `patch` into `base` recursively for plain objects; arrays and primitives replace.
 * `undefined` in the patch is ignored; `null` is kept (it means "clear" for nullable fields).
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** Top-level paths ("section.key") whose values differ between a and b. */
export function changedKeys(a: unknown, b: unknown, prefix = ''): string[] {
  if (!isPlainObject(a) || !isPlainObject(b)) return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix || '(root)'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => changedKeys(a[k], b[k], prefix ? `${prefix}.${k}` : k));
}
