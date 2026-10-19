import { POPULAR_PACKAGES } from './popular-packages.js';

/** Optimal string alignment (restricted Damerau–Levenshtein) distance. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const POPULAR = new Set(POPULAR_PACKAGES);

/** The popular package `name` likely imitates, or null. Short names are skipped (too many near neighbours). */
export function typosquatOf(name: string): string | null {
  if (POPULAR.has(name) || name.length < 4) return null;
  for (const p of POPULAR_PACKAGES) {
    if (Math.abs(p.length - name.length) > 2) continue;
    const dist = editDistance(name, p);
    if (dist > 0 && dist <= (p.length <= 5 ? 1 : 2)) return p;
  }
  return null;
}
