import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SettingsSchema } from '../../shared/schemas.js';
import type { PackDetect, PackFileChange, PackManifest, PackResult, PackView, SettingsPatch } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';
import { templatesDir } from '../fs/templates.js';
import type { Project } from '../project.js';
import { merge3 } from './merge3.js';

/**
 * Team packs: bots, skills, goal templates and settings for a stack, installed into `.agentroom/`.
 * `runs/packs.lock.json` remembers what each pack installed (hashes), and `runs/packs/<name>/`
 * keeps those exact files as the base for a three-way merge, so updates never clobber your edits.
 */

const META_FILES = new Set(['pack.json', 'settings.partial.json', 'README.md']);
/** Where a file the pack wanted to change, but you'd edited the same lines, is put for you to merge. */
export const INCOMING_SUFFIX = '.pack-incoming';
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface LockEntry {
  version: string;
  origin: string;
  installedAt: string;
  files: Record<string, string>;
  settings: Record<string, unknown>;
}
interface Lock {
  version: 1;
  packs: Record<string, LockEntry>;
}

export interface PackSource {
  manifest: PackManifest;
  dir: string;
  origin: 'builtin' | 'local';
}

const hash = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

export function builtinPacksDir(): string {
  return path.join(templatesDir(), 'packs');
}

export function readManifest(dir: string): PackManifest {
  const raw = readJson<Partial<PackManifest> | null>(path.join(dir, 'pack.json'), null);
  if (!raw || typeof raw.name !== 'string' || !NAME.test(raw.name)) throw new Error(`${dir} isn't a pack (pack.json with a lowercase "name" is required)`);
  if (typeof raw.version !== 'string') throw new Error(`pack ${raw.name} has no version`);
  return {
    name: raw.name,
    title: raw.title ?? raw.name,
    description: raw.description ?? '',
    version: raw.version,
    stacks: Array.isArray(raw.stacks) ? raw.stacks.map(String) : [],
    detect: raw.detect ?? {},
  };
}

export function listBuiltinPacks(): PackSource[] {
  const dir = builtinPacksDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      try {
        return [{ manifest: readManifest(path.join(dir, e.name)), dir: path.join(dir, e.name), origin: 'builtin' as const }];
      } catch {
        return [];
      }
    });
}

/** A built-in pack by name, or a pack folder on disk. */
export function findPack(nameOrPath: string, cwd = process.cwd()): PackSource {
  const builtin = listBuiltinPacks().find((p) => p.manifest.name === nameOrPath);
  if (builtin) return builtin;
  const dir = path.resolve(cwd, nameOrPath);
  if (fs.existsSync(path.join(dir, 'pack.json'))) return { manifest: readManifest(dir), dir, origin: 'local' };
  const names = listBuiltinPacks().map((p) => p.manifest.name);
  throw new Error(`no pack "${nameOrPath}". Built in: ${names.join(', ') || 'none'}; or pass a folder with pack.json`);
}

// ---------- stack detection ----------

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Why this repo matches the pack, or null. */
export function detectMatch(root: string, detect: PackDetect): string | null {
  for (const f of detect.files ?? []) if (fs.existsSync(path.join(root, f))) return `${f} found`;
  if (detect.packageDeps?.length) {
    try {
      const pkg = JSON.parse(readText(path.join(root, 'package.json')) || '{}') as Record<string, Record<string, string> | undefined>;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hit = detect.packageDeps.find((d) => d in deps);
      if (hit) return `package.json depends on ${hit}`;
    } catch {
      /* not JSON */
    }
  }
  if (detect.pubspecDeps?.length) {
    const pubspec = readText(path.join(root, 'pubspec.yaml'));
    const hit = detect.pubspecDeps.find((d) => new RegExp(`^\\s+${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm').test(pubspec));
    if (hit) return `pubspec.yaml depends on ${hit}`;
  }
  return null;
}

/** Built-in packs that fit this repo, best first. */
export function suggestPacks(root: string): { pack: PackSource; reason: string }[] {
  return listBuiltinPacks().flatMap((pack) => {
    const reason = detectMatch(root, pack.manifest.detect);
    return reason ? [{ pack, reason }] : [];
  });
}

// ---------- files ----------

function packFiles(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.DS_Store') continue;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && !(rel === '' && META_FILES.has(e.name))) out.set(r, fs.readFileSync(path.join(dir, r)));
    }
  };
  walk('');
  return out;
}

function contents(dir: string): PackView['contents'] {
  const list = (sub: string, filter: (n: string) => boolean = () => true) =>
    fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)).filter(filter).sort() : [];
  return {
    bots: list('bots').map((d) => d.replace(/^\d+-/, '')),
    skills: list('skills'),
    goalTemplates: list('goal-templates', (n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, '')),
    settings: fs.existsSync(path.join(dir, 'settings.partial.json')),
  };
}

// ---------- settings ----------

type Flat = Record<string, unknown>;

/** `{ security: { sensitivePaths: [...] } }` → `{ "security.sensitivePaths": [...] }` (two levels). */
function flatten(obj: Record<string, unknown>): Flat {
  const out: Flat = {};
  for (const [section, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) out[`${section}.${k}`] = v;
  }
  return out;
}

function get(obj: Record<string, unknown>, key: string): unknown {
  const [section, k] = key.split('.');
  return (obj[section!] as Record<string, unknown> | undefined)?.[k!];
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge of the pack's settings into the team's. Lists merge item by item (your additions
 * stay, items the pack dropped go only if you hadn't touched them); a value you changed is kept.
 */
function mergeSettings(project: Project, incoming: Flat, base: Flat): { patch: SettingsPatch; applied: string[]; kept: string[] } {
  const current = project.settings.team() as unknown as Record<string, unknown>;
  const defaults = SettingsSchema.parse({}) as unknown as Record<string, unknown>;
  const patch: Record<string, Record<string, unknown>> = {};
  const applied: string[] = [];
  const kept: string[] = [];
  const set = (key: string, value: unknown) => {
    const [section, k] = key.split('.');
    (patch[section!] ??= {})[k!] = value;
    applied.push(key);
  };
  for (const [key, theirs] of Object.entries(incoming)) {
    const ours = get(current, key);
    const had = key in base ? base[key] : undefined;
    if (eq(ours, theirs)) continue;
    if (Array.isArray(theirs) && (Array.isArray(ours) || ours === undefined)) {
      const mine = (ours as unknown[] | undefined) ?? [];
      const dropped = Array.isArray(had) ? had.filter((x) => !theirs.some((t) => eq(t, x))) : [];
      const next = [...mine.filter((x) => !dropped.some((d) => eq(d, x))), ...theirs.filter((t) => !mine.some((x) => eq(x, t)))];
      if (!eq(next, mine)) set(key, next);
      continue;
    }
    const untouched = had === undefined ? eq(ours, get(defaults, key)) || ours === undefined : eq(ours, had);
    if (untouched) set(key, theirs);
    else kept.push(key);
  }
  return { patch: patch as SettingsPatch, applied, kept };
}

// ---------- the manager ----------

export class PackManager {
  constructor(private readonly project: Project) {}

  private get lockFile() {
    return path.join(this.project.paths.runs, 'packs.lock.json');
  }
  private baseDir(name: string) {
    return path.join(this.project.paths.runs, 'packs', name);
  }
  private lock(): Lock {
    const l = readJson<Lock | null>(this.lockFile, null);
    return l && l.packs ? l : { version: 1, packs: {} };
  }
  private saveLock(lock: Lock) {
    fs.mkdirSync(path.dirname(this.lockFile), { recursive: true });
    writeJson(this.lockFile, lock);
  }

  installed(): Record<string, LockEntry> {
    return this.lock().packs;
  }

  list(): PackView[] {
    const lock = this.lock();
    const sources = listBuiltinPacks();
    // A pack installed from a folder shows (and updates) from that folder, even if a built-in has its name.
    for (const [name, entry] of Object.entries(lock.packs)) {
      if (entry.origin === 'builtin') continue;
      try {
        const local: PackSource = { manifest: readManifest(entry.origin), dir: entry.origin, origin: 'local' };
        const i = sources.findIndex((s) => s.manifest.name === name);
        if (i >= 0) sources[i] = local;
        else sources.push(local);
      } catch {
        /* folder gone */
      }
    }
    return sources.map(({ manifest, dir, origin }) => {
      const reason = detectMatch(this.project.root, manifest.detect);
      const entry = lock.packs[manifest.name];
      return {
        ...manifest,
        origin,
        suggested: !!reason,
        ...(reason ? { reason } : {}),
        contents: contents(dir),
        ...(entry
          ? {
              installed: {
                version: entry.version,
                installedAt: entry.installedAt,
                files: Object.keys(entry.files).length,
                modified: this.modifiedCount(entry),
                updateAvailable: compareVersions(manifest.version, entry.version) > 0,
              },
            }
          : {}),
      };
    });
  }

  private modifiedCount(entry: LockEntry): number {
    return Object.entries(entry.files).filter(([rel, h]) => {
      const file = path.join(this.project.paths.dir, rel);
      return fs.existsSync(file) && hash(fs.readFileSync(file)) !== h;
    }).length;
  }

  /** Install, or update to the pack's current version. Same code path: a first install has no base. */
  apply(source: PackSource): PackResult {
    const { manifest, dir } = source;
    const lock = this.lock();
    const prev = lock.packs[manifest.name];
    const files = packFiles(dir);
    const changes: PackFileChange[] = [];
    const conflicts: string[] = [];
    const root = this.project.paths.dir;
    const baseDir = this.baseDir(manifest.name);

    if ([...files.keys()].some((f) => f.startsWith('goal-templates/')) && !fs.existsSync(this.project.paths.goalTemplates)) {
      // Projects using the built-in templates get a copy first, or the pack's would hide them.
      this.project.goalTemplates.saveDefaults();
    }

    const record: Record<string, string> = {};
    for (const [rel, theirs] of files) {
      const target = path.join(root, rel);
      if (!target.startsWith(root + path.sep)) throw new Error(`unsafe path in pack: ${rel}`);
      const basePath = path.join(baseDir, rel);
      const base = prev && fs.existsSync(basePath) ? fs.readFileSync(basePath) : null;
      const exists = fs.existsSync(target);
      const ours = exists ? fs.readFileSync(target) : null;
      record[rel] = hash(theirs);

      if (!ours) {
        if (base && prev?.files[rel]) {
          changes.push({ path: rel, action: 'skipped', note: 'you deleted it; left out' });
          delete record[rel];
          continue;
        }
        write(target, theirs);
        changes.push({ path: rel, action: 'created' });
      } else if (ours.equals(theirs)) {
        changes.push({ path: rel, action: 'unchanged' });
      } else if (base && ours.equals(base)) {
        write(target, theirs);
        changes.push({ path: rel, action: 'updated' });
      } else if (base && theirs.equals(base)) {
        changes.push({ path: rel, action: 'kept', note: 'your edits; the pack didn’t change it' });
        record[rel] = hash(base);
      } else {
        const merged = base ? merge3(base.toString('utf8'), ours.toString('utf8'), theirs.toString('utf8')) : { text: '', conflict: true };
        if (!merged.conflict) {
          write(target, Buffer.from(merged.text));
          changes.push({ path: rel, action: 'merged' });
          record[rel] = hash(Buffer.from(merged.text));
        } else {
          write(target + INCOMING_SUFFIX, theirs);
          conflicts.push(rel);
          changes.push({ path: rel, action: 'conflict', note: `${base ? 'you and the pack changed the same lines' : 'a file with this name already exists'}; the pack's version is in ${path.basename(rel)}${INCOMING_SUFFIX}` });
          // Never claim a file you already had: removing the pack must not delete it.
          if (prev?.files[rel]) record[rel] = prev.files[rel];
          else delete record[rel];
        }
      }
    }

    // Files the new version no longer ships: remove only if untouched.
    for (const rel of Object.keys(prev?.files ?? {})) {
      if (files.has(rel)) continue;
      const target = path.join(root, rel);
      if (!fs.existsSync(target)) continue;
      if (hash(fs.readFileSync(target)) === prev!.files[rel]) {
        fs.rmSync(target);
        pruneEmpty(path.dirname(target), root);
        changes.push({ path: rel, action: 'removed' });
      } else changes.push({ path: rel, action: 'kept', note: 'dropped from the pack, but you edited it' });
    }

    // Settings.
    const partial = readJson<Record<string, unknown> | null>(path.join(dir, 'settings.partial.json'), null);
    const incoming = partial ? flatten(partial) : {};
    const { patch, applied, kept } = mergeSettings(this.project, incoming, prev?.settings ?? {});
    if (applied.length) this.project.settings.update(patch, 'team');

    // New base = exactly what this version ships.
    fs.rmSync(baseDir, { recursive: true, force: true });
    for (const [rel, data] of files) write(path.join(baseDir, rel), data);
    lock.packs[manifest.name] = {
      version: manifest.version,
      origin: source.origin === 'builtin' ? 'builtin' : dir,
      installedAt: new Date().toISOString(),
      files: record,
      settings: incoming,
    };
    this.saveLock(lock);
    return { name: manifest.name, version: manifest.version, changes, settings: { applied, kept }, conflicts };
  }

  /** Update an installed pack from where it came from. */
  update(name: string): PackResult {
    const entry = this.lock().packs[name];
    if (!entry) throw new Error(`pack "${name}" isn't installed`);
    return this.apply(entry.origin === 'builtin' ? findPack(name) : { manifest: readManifest(entry.origin), dir: entry.origin, origin: 'local' });
  }

  /** Remove what the pack installed, except files you edited. Settings stay as they are. */
  remove(name: string): PackResult {
    const lock = this.lock();
    const entry = lock.packs[name];
    if (!entry) throw new Error(`pack "${name}" isn't installed`);
    const root = this.project.paths.dir;
    const changes: PackFileChange[] = [];
    for (const [rel, h] of Object.entries(entry.files)) {
      const target = path.join(root, rel);
      if (!fs.existsSync(target)) continue;
      if (hash(fs.readFileSync(target)) === h) {
        fs.rmSync(target);
        pruneEmpty(path.dirname(target), root);
        changes.push({ path: rel, action: 'removed' });
      } else changes.push({ path: rel, action: 'kept', note: 'you edited it' });
      fs.rmSync(target + INCOMING_SUFFIX, { force: true });
    }
    // Skills the pack added are unassigned from bots that remain.
    const gone = new Set(changes.filter((c) => c.action === 'removed' && /^skills\/[^/]+\/SKILL\.md$/.test(c.path)).map((c) => c.path.split('/')[1]!));
    if (gone.size) for (const bot of this.project.bots.list()) if (bot.skills.some((s) => gone.has(s))) this.project.bots.update(bot.id, { skills: bot.skills.filter((s) => !gone.has(s)) });
    fs.rmSync(this.baseDir(name), { recursive: true, force: true });
    delete lock.packs[name];
    this.saveLock(lock);
    return { name, version: entry.version, changes, settings: { applied: [], kept: Object.keys(entry.settings) }, conflicts: [] };
  }
}

/** Compare dotted versions numerically ("1.10.0" > "1.9.2"); non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    return Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
  }
  return 0;
}

function write(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function pruneEmpty(dir: string, stop: string) {
  let d = dir;
  while (d.startsWith(stop + path.sep) && d !== stop) {
    if (fs.readdirSync(d).length) return;
    fs.rmdirSync(d);
    d = path.dirname(d);
  }
}
