/** Small statistics helpers for experiments and estimates. Pure. */

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null;
}

/** log(n!) via a cached table (n is small: goals per experiment). */
const LOG_FACT: number[] = [0];
function logFact(n: number): number {
  for (let i = LOG_FACT.length; i <= n; i++) LOG_FACT[i] = LOG_FACT[i - 1]! + Math.log(i);
  return LOG_FACT[n]!;
}

/** P(X = a) for the 2×2 table [[a, b], [c, d]] with fixed margins (hypergeometric). */
function tableProb(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  return Math.exp(logFact(a + b) + logFact(c + d) + logFact(a + c) + logFact(b + d) - logFact(n) - logFact(a) - logFact(b) - logFact(c) - logFact(d));
}

/**
 * Two-sided Fisher exact test: is the success rate of A (s1 of n1) different from B (s2 of n2)?
 * Exact for the small samples experiments have. Returns 1 when either group is empty.
 */
export function fisherExact(s1: number, n1: number, s2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 1;
  const f1 = n1 - s1;
  const f2 = n2 - s2;
  const successes = s1 + s2;
  const observed = tableProb(s1, f1, s2, f2);
  let p = 0;
  const lo = Math.max(0, successes - n2);
  const hi = Math.min(n1, successes);
  for (let a = lo; a <= hi; a++) {
    const pr = tableProb(a, n1 - a, successes - a, n2 - (successes - a));
    // Tolerance so tables as likely as the observed one count as "as extreme".
    if (pr <= observed * (1 + 1e-7)) p += pr;
  }
  return Math.min(1, p);
}
