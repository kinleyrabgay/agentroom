import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TurnChanges, TurnFileChange } from '../../shared/types/index.js';

/** Built-in tools that write files, and where each names the file. */
export const WRITE_TOOLS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

const LIMITS = {
  files: 200,
  /** Larger files are listed without a diff. */
  fileBytes: 1024 * 1024,
  /** Patch text kept per file and per run; past it the patch is dropped (the counts stay). */
  patchBytes: 256 * 1024,
  runPatchBytes: 2 * 1024 * 1024,
};

interface Snapshot {
  exists: boolean;
  hash: string;
  /** Absent when the file is over the size limit. */
  content?: Buffer;
}

interface Entry {
  rel: string;
  first: Snapshot;
  last?: Snapshot;
  /** Set when the file changed between two of this run's own writes: someone else touched it, so the diff isn't the run's. */
  ambiguous?: string;
}

const ABSENT: Snapshot = { exists: false, hash: '' };

function snapshot(file: string): Snapshot {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return ABSENT;
  }
  if (!stat.isFile()) return ABSENT;
  if (stat.size > LIMITS.fileBytes) return { exists: true, hash: `size:${stat.size}:${stat.mtimeMs}` };
  const content = fs.readFileSync(file);
  return { exists: true, hash: createHash('sha256').update(content).digest('hex'), content };
}

/**
 * Tracks what one run writes, from its own write tools only (never `git status`, which would also show
 * your edits and other runs'). Each write tool's file is snapshotted before and after it runs; the run's
 * change is the first "before" against the last "after". A file that changed between two of the run's
 * own writes is left out rather than credited to the wrong author. Shell commands' writes aren't tracked.
 */
export class TurnTracker {
  private files = new Map<string, Entry>();
  private pending = new Map<string, string>();
  private skipped: TurnChanges['skipped'] = [];

  constructor(private readonly cwd: string) {}

  /** The file a write tool call targets, or null for other tools and paths outside the project. */
  target(tool: string, input: unknown): string | null {
    const key = WRITE_TOOLS[tool];
    const raw = key && input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
    if (typeof raw !== 'string' || !raw) return null;
    return path.resolve(this.cwd, raw);
  }

  /** Before a write tool runs. */
  before(toolUseId: string, tool: string, input: unknown) {
    const abs = this.target(tool, input);
    if (!abs) return;
    const rel = path.relative(this.cwd, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return;
    const now = snapshot(abs);
    const entry = this.files.get(abs);
    if (!entry) {
      if (this.files.size >= LIMITS.files) {
        if (!this.skipped.some((s) => s.path === rel)) this.skipped.push({ path: rel, reason: `over ${LIMITS.files} files` });
        return;
      }
      this.files.set(abs, { rel, first: now });
    } else if (entry.last && entry.last.hash !== now.hash && !entry.ambiguous) {
      entry.ambiguous = 'changed by something else between this run’s edits';
    }
    this.pending.set(toolUseId, abs);
  }

  /** After a write tool ran (or failed). */
  after(toolUseId: string) {
    const abs = this.pending.get(toolUseId);
    if (!abs) return;
    this.pending.delete(toolUseId);
    const entry = this.files.get(abs);
    if (entry) entry.last = snapshot(abs);
  }

  /** The run's changes, or null when it wrote nothing that's still different. */
  async finish(): Promise<TurnChanges | null> {
    // Tools that never reported back (denied, interrupted): read where they left the file.
    for (const id of [...this.pending.keys()]) this.after(id);
    const files: TurnFileChange[] = [];
    const skipped = [...this.skipped];
    let budget = LIMITS.runPatchBytes;
    for (const e of this.files.values()) {
      if (!e.last || e.last.hash === e.first.hash) continue;
      if (e.ambiguous) {
        skipped.push({ path: e.rel, reason: e.ambiguous });
        continue;
      }
      const status: TurnFileChange['status'] = !e.first.exists ? 'added' : !e.last.exists ? 'deleted' : 'modified';
      const change: TurnFileChange = { path: e.rel, status, additions: 0, deletions: 0, patch: '' };
      if (e.first.exists && !e.first.content) change.note = 'Too large to show.';
      else if (e.last.exists && !e.last.content) change.note = 'Too large to show.';
      else if (isBinary(e.first.content) || isBinary(e.last.content)) change.note = 'Binary file.';
      else {
        const patch = await unifiedDiff(e.first.content ?? Buffer.alloc(0), e.last.content ?? Buffer.alloc(0));
        const counts = countLines(patch);
        change.additions = counts.additions;
        change.deletions = counts.deletions;
        if (patch.length > LIMITS.patchBytes || patch.length > budget) change.note = 'Diff too large to keep.';
        else {
          change.patch = patch;
          budget -= patch.length;
        }
      }
      files.push(change);
    }
    if (!files.length && !skipped.length) return null;
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, skipped };
  }
}

const isBinary = (b?: Buffer) => !!b && b.subarray(0, 8000).includes(0);

export function countLines(patch: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

/** Unified diff of two buffers via `git diff --no-index`, file headers removed (starts at the first @@). */
export async function unifiedDiff(before: Buffer, after: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-turn-'));
  const a = path.join(dir, 'a');
  const b = path.join(dir, 'b');
  try {
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    const out = await new Promise<string>((resolve) => {
      execFile('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', a, b], { maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) =>
        // Exit code 1 means "different"; stdout holds the diff either way.
        resolve(String(stdout ?? '')),
      );
    });
    const at = out.indexOf('\n@@');
    return at === -1 ? (out.startsWith('@@') ? out : '') : out.slice(at + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
