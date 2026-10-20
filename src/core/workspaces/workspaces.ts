import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { slugify } from '../slug.js';

/**
 * Workspaces: several repos worked on as one (frontend + backend). A workspace is a small file in
 * `~/.agentroom/workspaces/<name>.json` listing repo folders; each repo keeps its own `.agentroom/`.
 * The primary repo hosts the team, board, settings and budgets.
 */

export const WORKSPACE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_WORKSPACE_REPOS = 8;

export const WorkspaceRepoSchema = z.object({
  /** Stable id within the workspace (slug of the folder name). */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  /** Absolute path of the repo folder. */
  path: z.string().min(1),
});

export const WorkspaceConfigSchema = z.object({
  name: z.string().regex(WORKSPACE_NAME),
  repos: z.array(WorkspaceRepoSchema).min(1).max(MAX_WORKSPACE_REPOS),
  /** Repo id that hosts the team and board; defaults to the first. */
  primary: z.string().optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type WorkspaceRepoConfig = z.infer<typeof WorkspaceRepoSchema>;

/** `~/.agentroom` (or `$AGENTROOM_HOME`, used by tests). */
export function agentroomHome(): string {
  return process.env.AGENTROOM_HOME ? path.resolve(process.env.AGENTROOM_HOME) : path.join(os.homedir(), '.agentroom');
}

export function workspacesDir(): string {
  return path.join(agentroomHome(), 'workspaces');
}

function assertName(name: string): string {
  if (!WORKSPACE_NAME.test(name)) throw new Error(`Workspace names are lowercase letters, digits and dashes (got "${name}").`);
  return name;
}

export function workspaceFile(name: string): string {
  return path.join(workspacesDir(), `${assertName(name)}.json`);
}

/** The workspace's primary repo (explicit, else the first one). */
export function primaryOf(workspace: WorkspaceConfig): WorkspaceRepoConfig {
  return workspace.repos.find((r) => r.id === workspace.primary) ?? workspace.repos[0]!;
}

export function loadWorkspace(name: string): WorkspaceConfig {
  const file = workspaceFile(name);
  if (!fs.existsSync(file)) {
    const known = listWorkspaces().map((r) => r.name);
    throw new Error(`No workspace "${name}".${known.length ? ` Workspaces: ${known.join(', ')}.` : ' Create one with `agentroom workspace create <name> <path...>`.'}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} isn't valid JSON: ${(err as Error).message}`);
  }
  const parsed = WorkspaceConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

export function listWorkspaces(): WorkspaceConfig[] {
  const dir = workspacesDir();
  if (!fs.existsSync(dir)) return [];
  const out: WorkspaceConfig[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(loadWorkspace(f.slice(0, -5)));
    } catch {
      // A broken file shows up when that workspace is loaded by name; the list skips it.
    }
  }
  return out;
}

function saveWorkspace(workspace: WorkspaceConfig): WorkspaceConfig {
  const valid = WorkspaceConfigSchema.parse(workspace);
  fs.mkdirSync(workspacesDir(), { recursive: true });
  const file = workspaceFile(valid.name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valid, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return valid;
}

/** Resolve and check a repo folder: exists, is a directory; returns its real absolute path. */
function realFolder(p: string): string {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`No such folder: ${abs}`);
  if (!fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  return fs.realpathSync(abs);
}

const inside = (child: string, parent: string) => child !== parent && child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Add folders to a repo list: dedupe, refuse nesting (the outer repo would index the inner one twice), unique ids. */
function withRepos(existing: WorkspaceRepoConfig[], paths: string[]): WorkspaceRepoConfig[] {
  const repos = [...existing];
  for (const p of paths) {
    const real = realFolder(p);
    if (repos.some((r) => r.path === real)) throw new Error(`${real} is already in the workspace.`);
    const nested = repos.find((r) => inside(real, r.path) || inside(r.path, real));
    if (nested) throw new Error(`${real} and ${nested.path} are nested; a workspace's repos must be separate folders.`);
    const base = slugify(path.basename(real), 'repo').slice(0, 36);
    let id = base;
    for (let n = 2; repos.some((r) => r.id === id); n++) id = `${base}-${n}`;
    repos.push({ id, path: real });
  }
  if (repos.length > MAX_WORKSPACE_REPOS) throw new Error(`A workspace holds at most ${MAX_WORKSPACE_REPOS} repos.`);
  return repos;
}

export function createWorkspace(name: string, paths: string[], opts: { primary?: string } = {}): WorkspaceConfig {
  assertName(name);
  if (fs.existsSync(workspaceFile(name))) throw new Error(`Workspace "${name}" already exists. Add repos with \`agentroom workspace add ${name} <path>\`.`);
  if (!paths.length) throw new Error('Give the workspace at least one repo folder.');
  const repos = withRepos([], paths);
  const primary = opts.primary ? resolveRepo({ name, repos }, opts.primary).id : repos[0]!.id;
  return saveWorkspace({ name, repos, primary, createdAt: new Date().toISOString() });
}

export function addRepos(name: string, paths: string[]): WorkspaceConfig {
  const workspace = loadWorkspace(name);
  return saveWorkspace({ ...workspace, repos: withRepos(workspace.repos, paths) });
}

/** Find a repo by id or folder path. */
export function resolveRepo(workspace: Pick<WorkspaceConfig, 'name' | 'repos'>, idOrPath: string): WorkspaceRepoConfig {
  const byId = workspace.repos.find((r) => r.id === idOrPath);
  if (byId) return byId;
  const abs = path.resolve(idOrPath);
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  const byPath = workspace.repos.find((r) => r.path === real || r.path === abs);
  if (byPath) return byPath;
  throw new Error(`"${idOrPath}" isn't in workspace "${workspace.name}" (repos: ${workspace.repos.map((r) => r.id).join(', ')}).`);
}

export function removeRepo(name: string, idOrPath: string): WorkspaceConfig {
  const workspace = loadWorkspace(name);
  const repo = resolveRepo(workspace, idOrPath);
  const repos = workspace.repos.filter((r) => r.id !== repo.id);
  if (!repos.length) throw new Error(`That's the last repo in "${name}". Delete the workspace instead: \`agentroom workspace delete ${name}\`.`);
  const primary = workspace.primary === repo.id ? repos[0]!.id : workspace.primary;
  return saveWorkspace({ ...workspace, repos, ...(primary ? { primary } : {}) });
}

export function setPrimary(name: string, idOrPath: string): WorkspaceConfig {
  const workspace = loadWorkspace(name);
  return saveWorkspace({ ...workspace, primary: resolveRepo(workspace, idOrPath).id });
}

/**
 * Get one of a workspace's other repos ready without scaffolding a team there: its `.agentroom/runs/`
 * (context graph cache) exists and is gitignored, unless the repo keeps `.agentroom/` private.
 * Returns true when it changed something.
 */
export function prepareMember(root: string, isPrivate: (root: string) => boolean): boolean {
  const runs = path.join(root, '.agentroom', 'runs');
  let changed = false;
  if (!fs.existsSync(runs)) {
    fs.mkdirSync(runs, { recursive: true });
    changed = true;
  }
  if (isPrivate(root) || !fs.existsSync(path.join(root, '.git'))) return changed;
  const gitignore = path.join(root, '.gitignore');
  const line = '.agentroom/runs/';
  const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  const lines = current.split(/\r?\n/);
  if (lines.includes(line) || lines.includes('.agentroom/') || lines.includes('.agentroom')) return changed;
  fs.writeFileSync(gitignore, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
  return true;
}

export function deleteWorkspace(name: string): void {
  const file = workspaceFile(name);
  if (!fs.existsSync(file)) throw new Error(`No workspace "${name}".`);
  fs.rmSync(file);
}
