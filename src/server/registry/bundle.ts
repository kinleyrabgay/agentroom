import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../core/fs/frontmatter.js';
import { slugify } from '../../core/slug.js';
import type { InstalledSkillInfo, SkillPreview, SkillPreviewFile } from '../../shared/types/index.js';
import { detectInjection } from '../security/injection.js';
import { type FileMap, writeTarGz } from './archive.js';

/** A skill fetched from somewhere, before the human has looked at it. */
export interface SkillBundle {
  files: FileMap;
  /** Where it came from: `skills.sh:owner/repo/skill@sha`, `https://…/x.tgz`, `file:name.zip`. */
  source: string;
  version?: string;
  /** sha256 of the downloaded archive, when the registry published one and it matched. */
  verifiedSha256?: string;
}

export const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

const EXEC_EXT = /\.(sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd|exe|bin|jar|so|dylib|dll)$/i;
const SHA_LINE = /^sha256:.*$/m;

/** One hash for a set of files: order-independent, content-addressed. */
export function contentHash(files: FileMap): string {
  const lines = [...files.keys()].sort().map((p) => `${p}\0${sha256(files.get(p)!)}`);
  return sha256(lines.join('\n'));
}

function isText(data: Buffer): boolean {
  if (data.subarray(0, 8192).includes(0)) return false;
  return !data.toString('utf8').includes('�');
}

export function looksExecutable(p: string, data: Buffer): boolean {
  return EXEC_EXT.test(p) || p.startsWith('scripts/') || data.subarray(0, 2).toString() === '#!';
}

/** Split `---` frontmatter from the body without parsing it (keeps unknown/nested keys exactly). */
function splitDoc(text: string): { fm: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { fm: m[1]!, body: text.slice(m[0].length) } : { fm: null, body: text };
}

/** Name, description and version as the skill declares them. */
export function skillMeta(files: FileMap, fallbackName = 'skill'): { name: string; description: string; version?: string; source?: string } {
  const md = files.get('SKILL.md');
  if (!md) throw new Error('no SKILL.md found');
  const { data } = parseFrontmatter(md.toString('utf8'));
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
  return {
    name: slugify(str(data.name) ?? fallbackName, fallbackName),
    description: str(data.description) ?? '',
    ...(str(data.version) ? { version: str(data.version)! } : {}),
    ...(str(data.source) ? { source: str(data.source)! } : {}),
  };
}

/**
 * Add where the skill came from to its frontmatter: `source`, `version` (unless the skill declares
 * its own) and `sha256` of the installed files, so later edits show as "modified".
 */
export function withProvenance(files: FileMap, source: string, version: string | undefined, name: string): FileMap {
  const out: FileMap = new Map(files);
  const text = files.get('SKILL.md')!.toString('utf8');
  const { fm, body } = splitDoc(text);
  let lines = (fm ?? `name: ${name}`).split(/\r?\n/).filter((l) => !/^(source|sha256):/.test(l));
  if (!lines.some((l) => /^name:/.test(l))) lines.unshift(`name: ${name}`);
  lines.push(`source: ${JSON.stringify(source)}`);
  if (version && !lines.some((l) => /^version:/.test(l))) lines.push(`version: ${JSON.stringify(version)}`);
  const draft = `---\n${lines.join('\n')}\n---\n${body.replace(/^\r?\n/, '')}`;
  out.set('SKILL.md', Buffer.from(draft));
  const hash = installedHash(out);
  out.set('SKILL.md', Buffer.from(draft.replace(/\n---\n/, `\nsha256: ${hash}\n---\n`)));
  return out;
}

/** Hash of installed files, ignoring the `sha256:` line itself. */
export function installedHash(files: FileMap): string {
  const copy: FileMap = new Map(files);
  const md = copy.get('SKILL.md');
  if (md) copy.set('SKILL.md', Buffer.from(md.toString('utf8').replace(SHA_LINE, '').replace(/\n\n---\n/, '\n---\n')));
  return contentHash(copy);
}

export function readDirFiles(dir: string): FileMap {
  const files: FileMap = new Map();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && e.name !== '.DS_Store') files.set(r, fs.readFileSync(path.join(dir, r)));
    }
  };
  if (fs.existsSync(dir)) walk('');
  return files;
}

/** Provenance of an installed library skill, or null for hand-written ones. */
export function installedInfo(dir: string, name: string): InstalledSkillInfo | null {
  const files = readDirFiles(dir);
  const md = files.get('SKILL.md');
  if (!md) return null;
  const { data } = parseFrontmatter(md.toString('utf8'));
  if (typeof data.source !== 'string') return null;
  const recorded = typeof data.sha256 === 'string' ? data.sha256 : undefined;
  return {
    name,
    source: data.source,
    ...(data.version !== undefined ? { version: String(data.version) } : {}),
    ...(recorded ? { sha256: recorded } : {}),
    modified: recorded ? installedHash(files) !== recorded : false,
  };
}

/** Everything the human should read before installing. Nothing is written. */
export function previewBundle(id: string, bundle: SkillBundle, libraryDir: string): SkillPreview {
  const meta = skillMeta(bundle.files);
  const files: SkillPreviewFile[] = [...bundle.files.entries()]
    .sort(([a], [b]) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)))
    .map(([p, d]) => ({ path: p, size: d.length, executable: looksExecutable(p, d), ...(isText(d) ? { text: d.toString('utf8') } : {}) }));
  const warnings: SkillPreview['warnings'] = [];
  for (const f of files) {
    for (const m of detectInjection(f.text ?? '')) warnings.push({ label: `${f.path}: ${m.label}`, excerpt: m.excerpt });
  }
  const scripts = files.filter((f) => f.executable);
  if (scripts.length)
    warnings.push({
      label: `${scripts.length} script${scripts.length === 1 ? '' : 's'} included`,
      excerpt: `${scripts.map((s) => s.path).join(', ')}. Never run on install, but a bot using this skill may run them. Read them first.`,
    });
  if (files.some((f) => f.text === undefined)) warnings.push({ label: 'Binary files included', excerpt: files.filter((f) => f.text === undefined).map((f) => f.path).join(', ') });
  const dir = path.join(libraryDir, meta.name);
  const existing = fs.existsSync(path.join(dir, 'SKILL.md')) ? installedInfo(dir, meta.name) : null;
  return {
    id,
    name: meta.name,
    description: meta.description,
    version: bundle.version ?? meta.version ?? '0.0.0',
    source: bundle.source,
    sha256: bundle.verifiedSha256 ?? contentHash(bundle.files),
    verified: !!bundle.verifiedSha256,
    skillMd: bundle.files.get('SKILL.md')!.toString('utf8'),
    files,
    warnings,
    exists: fs.existsSync(path.join(dir, 'SKILL.md')) ? { ...(existing ? { source: existing.source, ...(existing.version ? { version: existing.version } : {}) } : {}), modified: existing?.modified ?? true } : null,
  };
}

/**
 * Write the skill into the library. Files are plain data (mode 0644): nothing is executed or
 * made executable. Replaces an existing skill of the same name only with `overwrite`.
 */
export function installBundle(bundle: SkillBundle, libraryDir: string, opts: { overwrite?: boolean } = {}): { name: string; dir: string; sha256: string } {
  const meta = skillMeta(bundle.files);
  const dir = path.join(libraryDir, meta.name);
  if (fs.existsSync(dir) && !opts.overwrite) throw new Error(`a skill named "${meta.name}" already exists`);
  const files = withProvenance(bundle.files, bundle.source, bundle.version ?? meta.version, meta.name);
  const tmp = `${dir}.installing-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const target = path.join(tmp, rel);
    if (!target.startsWith(tmp + path.sep)) throw new Error(`unsafe path ${rel}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { mode: 0o644 });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return { name: meta.name, dir, sha256: installedHash(files) };
}

// ---------- publish ----------

export interface PublishCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Checks a skill folder against the SKILL.md format before packing it. */
export function validateSkill(dir: string): PublishCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const files = readDirFiles(dir);
  const md = files.get('SKILL.md');
  if (!md) return { ok: false, errors: ['SKILL.md is missing'], warnings };
  const { data, body } = parseFrontmatter(md.toString('utf8'));
  const folder = path.basename(dir);
  if (typeof data.name !== 'string' || !data.name) errors.push('frontmatter `name` is required');
  else if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(data.name)) errors.push('`name` must be lowercase letters, digits and hyphens (max 64)');
  else if (data.name !== folder) warnings.push(`\`name\` (${data.name}) differs from the folder name (${folder})`);
  if (typeof data.description !== 'string' || data.description.trim().length < 20) errors.push('`description` is required: say what the skill does and when to use it (20+ characters)');
  else if (data.description.length > 1024) errors.push('`description` is longer than 1024 characters');
  if (body.trim().length < 50) errors.push('the body is nearly empty: add the instructions');
  for (const [p, d] of files) {
    if (d.length > 1_000_000) errors.push(`${p} is larger than 1 MB`);
    if (isText(d)) for (const m of detectInjection(d.toString('utf8'))) warnings.push(`${p}: ${m.label} (“${m.excerpt}”)`);
    if (/(^|\/)\.env|\.pem$|\.key$|id_rsa/.test(p)) errors.push(`${p} looks like a secret; remove it`);
  }
  return { ok: !errors.length, errors, warnings };
}

export interface PublishOutput {
  tarball: string;
  entry: Record<string, unknown>;
  entryFile: string;
}

/**
 * Pack a skill for an AgentRoom-format registry: `<name>-<version>.tgz` plus the index entry to
 * add to the registry's index.json. Nothing is uploaded.
 */
export function packSkill(dir: string, outDir: string, opts: { version?: string; author?: string; baseUrl?: string } = {}): PublishOutput {
  const check = validateSkill(dir);
  if (!check.ok) throw new Error(`fix these first:\n- ${check.errors.join('\n- ')}`);
  const files = readDirFiles(dir);
  // Strip install provenance: the registry entry is the source of truth for the published copy.
  const md = files.get('SKILL.md')!.toString('utf8');
  const { fm, body } = splitDoc(md);
  if (fm) files.set('SKILL.md', Buffer.from(`---\n${fm.split(/\r?\n/).filter((l) => !/^(source|sha256):/.test(l)).join('\n')}\n---\n${body.replace(/^\r?\n/, '')}`));
  const meta = skillMeta(files);
  const version = opts.version ?? meta.version ?? '0.1.0';
  const tgz = writeTarGz(files);
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${meta.name}-${version}.tgz`;
  const tarball = path.join(outDir, fileName);
  fs.writeFileSync(tarball, tgz);
  const entry = {
    name: meta.name,
    description: meta.description,
    version,
    ...(opts.author ? { author: opts.author } : {}),
    url: opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, '')}/${fileName}` : fileName,
    sha256: sha256(tgz),
  };
  const entryFile = path.join(outDir, `${meta.name}-${version}.index-entry.json`);
  fs.writeFileSync(entryFile, `${JSON.stringify(entry, null, 2)}\n`);
  return { tarball, entry, entryFile };
}
