import fs from 'node:fs';
import path from 'node:path';
import type { ProjectPaths } from './paths.js';

/**
 * Goals and tasks used to live in `.agentroom/tasks/board.json` (committed). They are personal
 * working state, so they now live in `runs/board.json`. Moves the old file once; never loses data.
 * Returns a one-line message when something happened, else null.
 */
export function migrateBoard(paths: ProjectPaths): string | null {
  const from = paths.legacyTasksFile;
  const to = paths.tasksFile;
  if (!fs.existsSync(from)) return null;
  if (fs.existsSync(to)) {
    const newer = fs.statSync(from).mtimeMs > fs.statSync(to).mtimeMs ? from : to;
    if (newer === from) {
      return `Warning: both ${rel(paths, from)} and ${rel(paths, to)} exist and the old one is newer. Using ${rel(paths, to)}; check the old file and delete it when done.`;
    }
    return `Warning: ${rel(paths, from)} is no longer used (goals and tasks live in ${rel(paths, to)}). Delete it when you no longer need it.`;
  }
  const raw = fs.readFileSync(from, 'utf8');
  JSON.parse(raw); // refuse to move a broken file
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, raw);
  JSON.parse(fs.readFileSync(to, 'utf8'));
  fs.rmSync(from);
  const dir = path.dirname(from);
  if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  return `Moved goals and tasks to ${rel(paths, to)} (local, not committed)`;
}

const rel = (paths: ProjectPaths, p: string) => path.relative(paths.root, p);
