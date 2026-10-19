import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { newFileDiff } from './diff.js';

/** Git access the security layer needs, behind an interface so tests can fake it. */
export interface GitReader {
  /** Current commit sha, or null outside a git repo. */
  head(): Promise<string | null>;
  /** Working tree (tracked changes + untracked files) relative to `base` (default HEAD). */
  workingDiff(base?: string): Promise<string>;
  /** What `git commit` would record. */
  stagedDiff(): Promise<string>;
  /** Commits not yet pushed: `range` like "base..HEAD"; falls back to upstream..HEAD, then HEAD~1..HEAD. */
  rangeDiff(range?: string): Promise<string>;
}

const MAX_BUFFER = 64 * 1024 * 1024;
/** Untracked files larger than this aren't inlined into the scanned diff. */
const MAX_UNTRACKED_BYTES = 512 * 1024;

export class CliGitReader implements GitReader {
  constructor(private readonly cwd: string) {}

  private git(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('git', args, { cwd: this.cwd, maxBuffer: MAX_BUFFER, timeout: 30_000 }, (err, stdout) => resolve(err ? null : stdout));
    });
  }

  async head() {
    return (await this.git(['rev-parse', 'HEAD']))?.trim() || null;
  }

  async workingDiff(base = 'HEAD') {
    const tracked = (await this.git(['diff', '--no-color', '--no-ext-diff', base])) ?? '';
    const untracked = ((await this.git(['ls-files', '--others', '--exclude-standard'])) ?? '').split('\n').filter(Boolean);
    const extra: string[] = [];
    for (const rel of untracked) {
      try {
        const abs = path.join(this.cwd, rel);
        if (fs.statSync(abs).size > MAX_UNTRACKED_BYTES) continue;
        extra.push(newFileDiff(rel, fs.readFileSync(abs, 'utf8')));
      } catch {
        // unreadable: skip
      }
    }
    return [tracked, ...extra].filter(Boolean).join('\n');
  }

  async stagedDiff() {
    return (await this.git(['diff', '--no-color', '--no-ext-diff', '--cached'])) ?? '';
  }

  async rangeDiff(range?: string) {
    for (const r of [range, '@{upstream}..HEAD', 'HEAD~1..HEAD']) {
      if (!r) continue;
      const out = await this.git(['diff', '--no-color', '--no-ext-diff', r]);
      if (out !== null) return out;
    }
    return '';
  }
}
