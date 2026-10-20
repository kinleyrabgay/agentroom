import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { slugify } from '../slug.js';

/**
 * Rooms: several repos worked on as one (frontend + backend). A room is a small file in
 * `~/.agentroom/rooms/<name>.json` listing repo folders; each repo keeps its own `.agentroom/`.
 * The primary repo hosts the team, board, settings and budgets.
 */

export const ROOM_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_ROOM_REPOS = 8;

export const RoomRepoSchema = z.object({
  /** Stable id within the room (slug of the folder name). */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  /** Absolute path of the repo folder. */
  path: z.string().min(1),
});

export const RoomConfigSchema = z.object({
  name: z.string().regex(ROOM_NAME),
  repos: z.array(RoomRepoSchema).min(1).max(MAX_ROOM_REPOS),
  /** Repo id that hosts the team and board; defaults to the first. */
  primary: z.string().optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type RoomConfig = z.infer<typeof RoomConfigSchema>;
export type RoomRepoConfig = z.infer<typeof RoomRepoSchema>;

/** `~/.agentroom` (or `$AGENTROOM_HOME`, used by tests). */
export function agentroomHome(): string {
  return process.env.AGENTROOM_HOME ? path.resolve(process.env.AGENTROOM_HOME) : path.join(os.homedir(), '.agentroom');
}

export function roomsDir(): string {
  return path.join(agentroomHome(), 'rooms');
}

function assertName(name: string): string {
  if (!ROOM_NAME.test(name)) throw new Error(`Room names are lowercase letters, digits and dashes (got "${name}").`);
  return name;
}

export function roomFile(name: string): string {
  return path.join(roomsDir(), `${assertName(name)}.json`);
}

/** The room's primary repo (explicit, else the first one). */
export function primaryOf(room: RoomConfig): RoomRepoConfig {
  return room.repos.find((r) => r.id === room.primary) ?? room.repos[0]!;
}

export function loadRoom(name: string): RoomConfig {
  const file = roomFile(name);
  if (!fs.existsSync(file)) {
    const known = listRooms().map((r) => r.name);
    throw new Error(`No room "${name}".${known.length ? ` Rooms: ${known.join(', ')}.` : ' Create one with `agentroom room create <name> <path...>`.'}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} isn't valid JSON: ${(err as Error).message}`);
  }
  const parsed = RoomConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

export function listRooms(): RoomConfig[] {
  const dir = roomsDir();
  if (!fs.existsSync(dir)) return [];
  const out: RoomConfig[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(loadRoom(f.slice(0, -5)));
    } catch {
      // A broken file shows up when that room is loaded by name; the list skips it.
    }
  }
  return out;
}

function saveRoom(room: RoomConfig): RoomConfig {
  const valid = RoomConfigSchema.parse(room);
  fs.mkdirSync(roomsDir(), { recursive: true });
  const file = roomFile(valid.name);
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
function withRepos(existing: RoomRepoConfig[], paths: string[]): RoomRepoConfig[] {
  const repos = [...existing];
  for (const p of paths) {
    const real = realFolder(p);
    if (repos.some((r) => r.path === real)) throw new Error(`${real} is already in the room.`);
    const nested = repos.find((r) => inside(real, r.path) || inside(r.path, real));
    if (nested) throw new Error(`${real} and ${nested.path} are nested; a room's repos must be separate folders.`);
    const base = slugify(path.basename(real), 'repo').slice(0, 36);
    let id = base;
    for (let n = 2; repos.some((r) => r.id === id); n++) id = `${base}-${n}`;
    repos.push({ id, path: real });
  }
  if (repos.length > MAX_ROOM_REPOS) throw new Error(`A room holds at most ${MAX_ROOM_REPOS} repos.`);
  return repos;
}

export function createRoom(name: string, paths: string[], opts: { primary?: string } = {}): RoomConfig {
  assertName(name);
  if (fs.existsSync(roomFile(name))) throw new Error(`Room "${name}" already exists. Add repos with \`agentroom room add ${name} <path>\`.`);
  if (!paths.length) throw new Error('Give the room at least one repo folder.');
  const repos = withRepos([], paths);
  const primary = opts.primary ? resolveRepo({ name, repos }, opts.primary).id : repos[0]!.id;
  return saveRoom({ name, repos, primary, createdAt: new Date().toISOString() });
}

export function addRepos(name: string, paths: string[]): RoomConfig {
  const room = loadRoom(name);
  return saveRoom({ ...room, repos: withRepos(room.repos, paths) });
}

/** Find a repo by id or folder path. */
export function resolveRepo(room: Pick<RoomConfig, 'name' | 'repos'>, idOrPath: string): RoomRepoConfig {
  const byId = room.repos.find((r) => r.id === idOrPath);
  if (byId) return byId;
  const abs = path.resolve(idOrPath);
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  const byPath = room.repos.find((r) => r.path === real || r.path === abs);
  if (byPath) return byPath;
  throw new Error(`"${idOrPath}" isn't in room "${room.name}" (repos: ${room.repos.map((r) => r.id).join(', ')}).`);
}

export function removeRepo(name: string, idOrPath: string): RoomConfig {
  const room = loadRoom(name);
  const repo = resolveRepo(room, idOrPath);
  const repos = room.repos.filter((r) => r.id !== repo.id);
  if (!repos.length) throw new Error(`That's the last repo in "${name}". Delete the room instead: \`agentroom room delete ${name}\`.`);
  const primary = room.primary === repo.id ? repos[0]!.id : room.primary;
  return saveRoom({ ...room, repos, ...(primary ? { primary } : {}) });
}

export function setPrimary(name: string, idOrPath: string): RoomConfig {
  const room = loadRoom(name);
  return saveRoom({ ...room, primary: resolveRepo(room, idOrPath).id });
}

/**
 * Get one of a room's other repos ready without scaffolding a team there: its `.agentroom/runs/`
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

export function deleteRoom(name: string): void {
  const file = roomFile(name);
  if (!fs.existsSync(file)) throw new Error(`No room "${name}".`);
  fs.rmSync(file);
}
