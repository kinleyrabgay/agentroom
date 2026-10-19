import { SLUG_PATTERN } from '../shared/constants.js';

export function slugify(s: string, fallback = 'item'): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

/** Reject names that could escape their folder (`..`, `/`) or aren't valid slugs. */
export function assertSlug(name: string, kind: string): string {
  if (!SLUG_PATTERN.test(name)) throw new Error(`invalid ${kind} name "${name}"`);
  return name;
}
