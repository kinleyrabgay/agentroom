/** Unified-diff parsing: which lines a change adds, per file. Pure — no git here. */

export interface AddedLine {
  /** 1-based line number in the new file. */
  line: number;
  text: string;
}

export interface FileDiff {
  path: string;
  /** The file did not exist before (new file / untracked). */
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  added: AddedLine[];
  removed: number;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
  paths: string[];
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse `git diff` output (any number of files). */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      cur = { path: m ? m[2] : raw.slice(11), isNew: false, isDeleted: false, isBinary: false, added: [], removed: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('new file mode')) cur.isNew = true;
    else if (raw.startsWith('deleted file mode')) cur.isDeleted = true;
    else if (raw.startsWith('Binary files')) cur.isBinary = true;
    else if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') cur.path = p.replace(/^b\//, '');
    } else if (raw.startsWith('--- ')) continue;
    else if (HUNK.test(raw)) newLine = Number(HUNK.exec(raw)![1]);
    else if (raw.startsWith('+')) cur.added.push({ line: newLine++, text: raw.slice(1) });
    else if (raw.startsWith('-')) cur.removed++;
    else if (raw.startsWith(' ')) newLine++;
  }
  return files;
}

export function diffStats(files: FileDiff[]): DiffStats {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.added.length, 0),
    deletions: files.reduce((n, f) => n + f.removed, 0),
    paths: files.map((f) => f.path),
  };
}

/** A synthetic "new file" diff for an untracked file's content. */
export function newFileDiff(path: string, content: string): string {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');
}
