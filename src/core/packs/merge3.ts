/**
 * Line-based three-way merge (diff3). Used when a pack updates a file you may have edited:
 * `base` is what the pack installed last time, `ours` is the file now, `theirs` is the new version.
 */

export interface Merge3Result {
  /** Merged text; equals `ours` when there is a conflict. */
  text: string;
  conflict: boolean;
}

/** Cells in the LCS table above this get a conservative answer instead (very large files). */
const MAX_CELLS = 4_000_000;

export function merge3(base: string, ours: string, theirs: string): Merge3Result {
  if (ours === theirs || theirs === base) return { text: ours, conflict: false };
  if (ours === base) return { text: theirs, conflict: false };

  const eol = ours.includes('\r\n') ? '\r\n' : '\n';
  const o = splitLines(base);
  const a = splitLines(ours);
  const b = splitLines(theirs);
  const ma = matchLines(o, a);
  const mb = matchLines(o, b);
  if (!ma || !mb) return { text: ours, conflict: true };

  const out: string[] = [];
  let i = 0;
  let ja = 0;
  let jb = 0;
  let conflict = false;
  const chunk = (oEnd: number, aEnd: number, bEnd: number) => {
    const po = o.slice(i, oEnd);
    const pa = a.slice(ja, aEnd);
    const pb = b.slice(jb, bEnd);
    if (same(pa, po)) out.push(...pb);
    else if (same(pb, po) || same(pa, pb)) out.push(...pa);
    else conflict = true;
  };

  while (i < o.length) {
    let k = i;
    while (k < o.length && (ma[k] === -1 || mb[k] === -1)) k++;
    if (k === o.length) break;
    if (k === i && ma[k] === ja && mb[k] === jb) {
      out.push(o[i]!);
      i++;
      ja++;
      jb++;
      continue;
    }
    chunk(k, ma[k]!, mb[k]!);
    i = k;
    ja = ma[k]!;
    jb = mb[k]!;
  }
  chunk(o.length, a.length, b.length);

  if (conflict) return { text: ours, conflict: true };
  const trailing = theirs.endsWith('\n') || ours.endsWith('\n');
  return { text: out.join(eol) + (trailing && out.length ? eol : ''), conflict: false };
}

function splitLines(s: string): string[] {
  const lines = s.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function same(x: string[], y: string[]): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** For each line of `o`, its matching line index in `x` (longest common subsequence), or -1. */
function matchLines(o: string[], x: string[]): number[] | null {
  const n = o.length;
  const m = x.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = o[i] === x[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (o[i] === x[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return match;
}
