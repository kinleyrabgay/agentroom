import { compareVersions } from '../../core/packs/packs.js';
import type { RegistrySearch, RegistrySkill, RegistrySource } from '../../shared/types/index.js';
import { type FileMap, LIMITS, readTar, readZip, safeRelPath, skillRoot } from './archive.js';
import { type SkillBundle, sha256 } from './bundle.js';

/** Fetch with a timeout and a size cap. Registry content is data: it's parsed, never executed. */
export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

const TIMEOUT_MS = 15_000;
const UA = { 'user-agent': 'agentroom-registry' };

export async function fetchBytes(fetcher: Fetcher, url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error(`only https URLs are allowed (${url})`);
  const res = await fetcher(url, { headers: { ...UA, ...headers } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > LIMITS.totalBytes * 2) throw new Error('download is too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > LIMITS.totalBytes * 2) throw new Error('download is too large');
  return buf;
}

async function fetchJson<T>(fetcher: Fetcher, url: string, headers?: Record<string, string>): Promise<T> {
  const buf = await fetchBytes(fetcher, url, { accept: 'application/json', ...headers });
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    throw new Error(`${new URL(url).host} didn't return JSON`);
  }
}

export const defaultFetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });

// ---------- AgentRoom index format ----------

/** `index.json` of an AgentRoom-format registry. */
export interface RegistryIndex {
  version: 1;
  name?: string;
  skills: { name: string; description: string; version: string; author?: string; tags?: string[]; url: string; sha256: string }[];
}

function parseIndex(raw: unknown): RegistryIndex {
  const idx = raw as Partial<RegistryIndex>;
  if (!idx || !Array.isArray(idx.skills)) throw new Error('not a registry index (missing "skills")');
  const skills = idx.skills.filter(
    (s) => s && typeof s.name === 'string' && typeof s.url === 'string' && typeof s.sha256 === 'string' && /^[a-f0-9]{64}$/.test(s.sha256),
  );
  return { version: 1, ...(idx.name ? { name: idx.name } : {}), skills };
}

// ---------- refs ----------
// index:<registryId>/<name>@<version> · skills-sh:<owner>/<repo>/<skillId> · github:<owner>/<repo>[/<skill>][@ref]
// https://…/x.tgz|.zip (with sha256 when known)

export class RegistryClient {
  private indexCache = new Map<string, { at: number; index: RegistryIndex }>();

  constructor(
    private readonly sources: () => RegistrySource[],
    private readonly fetcher: Fetcher = defaultFetcher,
  ) {}

  private async index(src: RegistrySource): Promise<RegistryIndex> {
    const hit = this.indexCache.get(src.url);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.index;
    const index = parseIndex(await fetchJson(this.fetcher, src.url));
    this.indexCache.set(src.url, { at: Date.now(), index });
    return index;
  }

  async search(q: string): Promise<RegistrySearch> {
    const query = q.trim().toLowerCase();
    const results: RegistrySkill[] = [];
    const errors: RegistrySearch['errors'] = [];
    await Promise.all(
      this.sources()
        .filter((s) => s.enabled)
        .map(async (src) => {
          try {
            if (src.kind === 'index') results.push(...(await this.searchIndex(src, query)));
            else results.push(...(await this.searchSkillsSh(src, query)));
          } catch (err) {
            errors.push({ registry: src.name, error: (err as Error).message });
          }
        }),
    );
    return { results, errors };
  }

  private async searchIndex(src: RegistrySource, q: string): Promise<RegistrySkill[]> {
    const index = await this.index(src);
    return index.skills
      .filter((s) => !q || `${s.name} ${s.description} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q))
      .slice(0, 50)
      .map((s) => ({
        ref: `index:${src.id}/${s.name}@${s.version}`,
        registry: src.name,
        name: s.name,
        description: s.description,
        version: s.version,
        ...(s.author ? { author: s.author } : {}),
        origin: new URL(s.url, src.url).toString(),
      }));
  }

  private async searchSkillsSh(src: RegistrySource, q: string): Promise<RegistrySkill[]> {
    if (q.length < 2) return [];
    const url = `${src.url.replace(/\/$/, '')}/api/search?q=${encodeURIComponent(q)}`;
    const data = await fetchJson<{ skills?: { source?: string; skillId?: string; name?: string; installs?: number }[] }>(this.fetcher, url);
    return (data.skills ?? [])
      .filter((s) => typeof s.source === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s.source) && typeof s.skillId === 'string')
      .slice(0, 30)
      .map((s) => ({
        ref: `skills-sh:${s.source}/${s.skillId}`,
        registry: src.name,
        name: s.name ?? s.skillId!,
        description: '',
        ...(typeof s.installs === 'number' ? { installs: s.installs } : {}),
        author: s.source!.split('/')[0]!,
        origin: `https://github.com/${s.source}`,
      }));
  }

  /** Download and unpack a skill for preview. Hash-checked when the registry publishes one. */
  async resolve(ref: string): Promise<SkillBundle> {
    if (ref.startsWith('index:')) return this.resolveIndex(ref);
    if (ref.startsWith('skills-sh:') || ref.startsWith('github:')) return this.resolveGithub(ref);
    if (/^https?:\/\//.test(ref)) return this.resolveUrl(ref);
    throw new Error(`unknown skill reference "${ref}"`);
  }

  private async resolveIndex(ref: string): Promise<SkillBundle> {
    const m = /^index:([^/]+)\/([^@]+)(?:@(.+))?$/.exec(ref);
    if (!m) throw new Error(`bad reference ${ref}`);
    const src = this.sources().find((s) => s.id === m[1] && s.kind === 'index');
    if (!src) throw new Error(`registry "${m[1]}" isn't configured`);
    const index = await this.index(src);
    const entries = index.skills.filter((s) => s.name === m[2]);
    const entry = m[3] ? entries.find((s) => s.version === m[3]) : entries.sort((a, b) => compareVersions(b.version, a.version))[0];
    if (!entry) throw new Error(`${m[2]} isn't in ${src.name}`);
    const url = new URL(entry.url, src.url).toString();
    const buf = await fetchBytes(this.fetcher, url);
    const got = sha256(buf);
    if (got !== entry.sha256) throw new Error(`hash mismatch for ${entry.name}: the index says ${entry.sha256.slice(0, 12)}…, the download is ${got.slice(0, 12)}…. Not installed.`);
    return { files: skillRoot(unpack(buf, url)), source: `${src.id}:${entry.name}`, version: entry.version, verifiedSha256: got };
  }

  private async resolveUrl(ref: string): Promise<SkillBundle> {
    const [url, expected] = ref.split('#sha256=');
    const buf = await fetchBytes(this.fetcher, url!);
    const got = sha256(buf);
    if (expected && expected !== got) throw new Error(`hash mismatch: expected ${expected.slice(0, 12)}…, got ${got.slice(0, 12)}…. Not installed.`);
    return { files: skillRoot(unpack(buf, url!)), source: url!, ...(expected ? { verifiedSha256: got } : {}) };
  }

  /**
   * Skills on skills.sh live in GitHub repos. Find the skill's folder in the repo tree (the same
   * places the `skills` CLI looks), pinned to a commit, and download its files.
   */
  private async resolveGithub(ref: string): Promise<SkillBundle> {
    const m = /^(?:skills-sh|github):([\w.-]+)\/([\w.-]+)(?:\/([\w.:-]+))?(?:@([\w./-]+))?$/.exec(ref);
    if (!m) throw new Error(`bad reference ${ref}`);
    const [, owner, repo, skill, wantRef] = m;
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const gh = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
    const commit = await fetchJson<{ sha: string }>(this.fetcher, `${api}/commits/${encodeURIComponent(wantRef ?? 'HEAD')}`, gh);
    const tree = await fetchJson<{ tree: { path: string; type: string; size?: number }[]; truncated?: boolean }>(this.fetcher, `${api}/git/trees/${commit.sha}?recursive=1`, gh);
    const skillFiles = tree.tree.filter((t) => t.type === 'blob' && /(^|\/)SKILL\.md$/.test(t.path));
    const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    const raw = (p: string) => `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${p.split('/').map(encodeURIComponent).join('/')}`;
    skillFiles.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
    let pick = skill ? skillFiles.find((t) => dirOf(t.path).split('/').pop() === skill) : skillFiles[0];
    if (!pick && skill) {
      // skills.sh ids are the frontmatter `name`, which can differ from the folder name.
      for (const t of skillFiles.slice(0, 80)) {
        const head = (await fetchBytes(this.fetcher, raw(t.path))).subarray(0, 4096).toString('utf8');
        const name = /^---[\s\S]*?^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(head)?.[1];
        if (name === skill) {
          pick = t;
          break;
        }
      }
    }
    if (!pick) throw new Error(`no skill ${skill ? `"${skill}" ` : ''}found in ${owner}/${repo}`);
    const dir = dirOf(pick.path);
    const blobs = tree.tree.filter((t) => t.type === 'blob' && (dir ? t.path.startsWith(`${dir}/`) : !t.path.includes('/') || t.path.startsWith('scripts/') || t.path.startsWith('references/')));
    if (blobs.length > LIMITS.files) throw new Error(`skill has more than ${LIMITS.files} files`);
    const files: FileMap = new Map();
    let total = 0;
    if (blobs.some((b) => (b.size ?? 0) > LIMITS.fileBytes)) throw new Error('a file in this skill is larger than 1 MB');
    if (blobs.reduce((n, b) => n + (b.size ?? 0), 0) > LIMITS.totalBytes) throw new Error('skill is larger than 5 MB');
    for (let i = 0; i < blobs.length; i += 8) {
      const batch = blobs.slice(i, i + 8);
      const datas = await Promise.all(batch.map((b) => fetchBytes(this.fetcher, raw(b.path))));
      batch.forEach((b, k) => {
        total += datas[k]!.length;
        files.set(safeRelPath(dir ? b.path.slice(dir.length + 1) : b.path), datas[k]!);
      });
      if (total > LIMITS.totalBytes) throw new Error('skill is larger than 5 MB');
    }
    const prefix = ref.startsWith('skills-sh:') ? 'skills.sh' : 'github';
    return { files, source: `${prefix}:${owner}/${repo}/${skill ?? (dir.split('/').pop() || repo)}@${commit.sha.slice(0, 12)}`, version: commit.sha.slice(0, 7) };
  }
}

/** Unpack an archive by its magic bytes (zip, gzip/tar) or treat it as a bare SKILL.md. */
export function unpack(buf: Buffer, nameHint = ''): FileMap {
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return readZip(buf);
  if ((buf[0] === 0x1f && buf[1] === 0x8b) || buf.subarray(257, 262).toString() === 'ustar') return readTar(buf);
  if (/\.md$/i.test(nameHint) || buf.subarray(0, 3).toString() === '---') return new Map([['SKILL.md', buf]]);
  throw new Error('unrecognised file: upload a SKILL.md, a .zip or a .tgz');
}
