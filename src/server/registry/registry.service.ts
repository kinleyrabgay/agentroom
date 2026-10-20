import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../../core/project.js';
import type { InstalledSkillInfo, RegistrySearch, RegistrySource, SkillPreview } from '../../shared/types/index.js';
import { readDirFiles, type SkillBundle, contentHash, installBundle, installedInfo, previewBundle } from './bundle.js';
import { skillRoot } from './archive.js';
import { type Fetcher, RegistryClient, defaultFetcher, unpack } from './client.js';

const PREVIEW_TTL_MS = 30 * 60_000;

/**
 * Browse, preview and install skills. Install is always two steps: `preview` fetches and unpacks
 * (nothing written), the human reads it, then `install` writes exactly what was previewed.
 */
export class RegistryService {
  readonly client: RegistryClient;
  private previews = new Map<string, { bundle: SkillBundle; at: number }>();

  constructor(
    private readonly project: Project,
    fetcher: Fetcher = defaultFetcher,
  ) {
    this.client = new RegistryClient(() => this.sources(), fetcher);
  }

  sources(): RegistrySource[] {
    return this.project.settings.get().registries.sources;
  }

  private get libraryDir() {
    return this.project.paths.skills;
  }

  installed(): InstalledSkillInfo[] {
    return this.project.library.list().flatMap((s) => {
      const info = installedInfo(path.join(this.libraryDir, s.name), s.name);
      return info ? [info] : [];
    });
  }

  async search(q: string): Promise<RegistrySearch> {
    const res = await this.client.search(q);
    const mine = new Map(this.installed().map((i) => [i.name, i]));
    const names = new Set(this.project.library.list().map((s) => s.name));
    for (const r of res.results) {
      const i = mine.get(r.name);
      if (i) r.installed = { ...(i.version ? { version: i.version } : {}), source: i.source };
      else if (names.has(r.name)) r.installed = {};
    }
    return res;
  }

  private remember(bundle: SkillBundle): SkillPreview {
    const now = Date.now();
    for (const [k, v] of this.previews) if (now - v.at > PREVIEW_TTL_MS) this.previews.delete(k);
    const id = crypto.randomUUID();
    this.previews.set(id, { bundle, at: now });
    return previewBundle(id, bundle, this.libraryDir);
  }

  async preview(ref: string): Promise<SkillPreview> {
    return this.remember(await this.client.resolve(ref.trim()));
  }

  /** A file the human uploaded or downloaded (SKILL.md, .zip, .tgz) — e.g. a skill bought on a marketplace. */
  previewUpload(fileName: string, data: Buffer): SkillPreview {
    const files = skillRoot(unpack(data, fileName));
    return this.remember({ files, source: `file:${path.basename(fileName).replace(/[^\w.@-]/g, '_')}` });
  }

  /** A folder or file on this machine (CLI). */
  previewLocal(p: string): SkillPreview {
    const abs = path.resolve(p);
    const files = fs.statSync(abs).isDirectory() ? readDirFiles(abs) : unpack(fs.readFileSync(abs), abs);
    return this.remember({ files: skillRoot(files), source: `file:${path.basename(abs)}` });
  }

  install(previewId: string, opts: { overwrite?: boolean } = {}) {
    const hit = this.previews.get(previewId);
    if (!hit) throw new Error('that preview expired; open the skill again');
    const result = installBundle(hit.bundle, this.libraryDir, opts);
    this.previews.delete(previewId);
    return { ...result, source: hit.bundle.source, version: hit.bundle.version };
  }

  /** Fetch the latest copy of an installed skill for review. `changed` = differs from what's installed. */
  async checkUpdate(name: string): Promise<{ preview: SkillPreview; changed: boolean }> {
    const info = installedInfo(path.join(this.libraryDir, name), name);
    if (!info) throw new Error(`${name} wasn't installed from a registry`);
    const ref = refFromSource(info.source);
    if (!ref) throw new Error(`${name} came from ${info.source}; re-import the file to update it`);
    const bundle = await this.client.resolve(ref);
    const current = readDirFiles(path.join(this.libraryDir, name));
    const strip = (files: typeof current) => {
      const copy = new Map(files);
      const md = copy.get('SKILL.md');
      if (md) copy.set('SKILL.md', Buffer.from(md.toString('utf8').replace(/^(source|sha256|version):.*\n/gm, '')));
      return contentHash(copy);
    };
    return { preview: this.remember(bundle), changed: strip(bundle.files) !== strip(current) };
  }
}

/** Where to look for a newer copy, from the `source:` an install recorded. */
export function refFromSource(source: string): string | null {
  let m = /^(skills\.sh|github):([\w.-]+\/[\w.-]+\/[\w.:-]+)@/.exec(source);
  if (m) return `${m[1] === 'skills.sh' ? 'skills-sh' : 'github'}:${m[2]}`;
  if (/^https?:\/\//.test(source)) return source;
  m = /^([a-z0-9][a-z0-9-]*):([a-z0-9][\w-]*)$/.exec(source);
  if (m && m[1] !== 'file') return `index:${m[1]}/${m[2]}`;
  return null;
}
