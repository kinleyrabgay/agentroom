/** One file of a multi-file unified diff (`gh pr diff`, `git diff`). */
export interface DiffFile {
  path: string;
  diff: string;
  additions: number;
  deletions: number;
}

/** Split a unified diff into files (new path; old path for deletions). */
export function splitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const parts = diff.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  for (const part of parts) {
    const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(part)?.[1];
    const minus = /^--- (?:a\/)?(.+)$/m.exec(part)?.[1];
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(part);
    const path = (plus && plus !== '/dev/null' ? plus : minus && minus !== '/dev/null' ? minus : header?.[2]) ?? 'unknown';
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of part.split('\n')) {
      if (line.startsWith('@@')) inHunk = true;
      else if (inHunk && line.startsWith('+')) additions++;
      else if (inHunk && line.startsWith('-')) deletions++;
    }
    files.push({ path: path.trim(), diff: part, additions, deletions });
  }
  return files;
}

/**
 * Lines GitHub accepts review comments on: `path:RIGHT:n` for added/context lines (new numbering),
 * `path:LEFT:n` for removed/context lines (old numbering).
 */
export function commentableLines(diff: string): Set<string> {
  const ok = new Set<string>();
  for (const f of splitDiff(diff)) {
    let oldNo = 0;
    let newNo = 0;
    let inHunk = false;
    for (const raw of f.diff.split('\n')) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (h) {
        oldNo = Number(h[1]);
        newNo = Number(h[2]);
        inHunk = true;
        continue;
      }
      if (!inHunk || raw.startsWith('\\')) continue;
      if (raw.startsWith('diff --git')) break;
      if (raw.startsWith('+')) ok.add(`${f.path}:RIGHT:${newNo++}`);
      else if (raw.startsWith('-')) ok.add(`${f.path}:LEFT:${oldNo++}`);
      else if (raw.startsWith(' ')) {
        ok.add(`${f.path}:RIGHT:${newNo++}`);
        ok.add(`${f.path}:LEFT:${oldNo++}`);
      }
    }
  }
  return ok;
}
