import fs from 'node:fs';
import { GithubContentType } from '../../../shared/enums.js';
import type { GithubBoard, GithubItem, GithubItemDetail, GithubProjectConfig, GithubUser } from '../../../shared/types/index.js';
import { readJson, writeJson } from '../../../core/fs/json.js';
import { GITHUB_COLUMNS_MAX_AGE_MS, GITHUB_MAX_PAGES } from '../../config/constants.js';
import { GhError, type GhClient } from './gh-client.js';
import { pickStatusField, toComments, toItem, type RawItem, type RawSingleSelectField } from './mapper.js';
import {
  addAssigneeMutation,
  itemDetailQuery,
  itemsPageQuery,
  projectMetaQuery,
  removeAssigneeMutation,
  viewerQuery,
} from './queries.js';
import { parseProjectUrl } from './url.js';

export interface GithubProjectPaths {
  /** `.agentroom/github/project.json` — committed. */
  projectFile: string;
  /** `.agentroom/runs/github-items.json` — local cache. */
  itemsCache: string;
}

interface ItemsCache {
  items: GithubItem[];
  viewer: GithubUser | null;
  fetchedAt: number;
}

interface MetaResponse {
  owner: { projectV2: { id: string; title: string; fields: { nodes: (RawSingleSelectField | null)[] } } | null } | null;
}
interface ItemsResponse {
  viewer: GithubUser;
  owner: { projectV2: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (RawItem | null)[] } } | null } | null;
}
interface DetailResponse {
  node: (RawItem & { body?: { body?: string; comments?: Parameters<typeof toComments>[0] } | null }) | null;
}

/**
 * The GitHub project behind the Board view.
 * Columns are configuration (cached in the committed project.json, re-synced rarely);
 * items are live data, cached locally so the board renders instantly.
 */
export class GithubProjectService {
  constructor(
    private readonly gh: GhClient,
    private readonly paths: GithubProjectPaths,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- configuration ----------

  config(): GithubProjectConfig | null {
    return readJson<GithubProjectConfig | null>(this.paths.projectFile, null);
  }

  private requireConfig(): GithubProjectConfig {
    const cfg = this.config();
    if (!cfg) throw new Error('No GitHub project connected. Paste a project URL first.');
    return cfg;
  }

  private save(cfg: GithubProjectConfig): GithubProjectConfig {
    writeJson(this.paths.projectFile, cfg);
    return cfg;
  }

  /** Resolve a project URL, fetch its columns and save the configuration. Clears any old item cache. */
  async connect(url: string): Promise<GithubProjectConfig> {
    const ref = parseProjectUrl(url);
    const meta = await this.fetchMeta(ref.ownerType, ref.owner, ref.number);
    const previous = this.config();
    const keepHidden = previous && previous.projectId === meta.projectId ? previous.hiddenColumns : [];
    fs.rmSync(this.paths.itemsCache, { force: true });
    return this.save({
      url: ref.url,
      owner: ref.owner,
      ownerType: ref.ownerType,
      number: ref.number,
      ...meta,
      hiddenColumns: keepHidden.filter((id) => meta.columns.some((c) => c.id === id)),
      columnsSyncedAt: new Date(this.now()).toISOString(),
    });
  }

  disconnect(): void {
    fs.rmSync(this.paths.projectFile, { force: true });
    fs.rmSync(this.paths.itemsCache, { force: true });
  }

  async syncColumns(): Promise<GithubProjectConfig> {
    const cfg = this.requireConfig();
    const meta = await this.fetchMeta(cfg.ownerType, cfg.owner, cfg.number);
    return this.save({
      ...cfg,
      ...meta,
      hiddenColumns: cfg.hiddenColumns.filter((id) => meta.columns.some((c) => c.id === id)),
      columnsSyncedAt: new Date(this.now()).toISOString(),
    });
  }

  setHiddenColumns(ids: string[]): GithubProjectConfig {
    const cfg = this.requireConfig();
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('hiddenColumns must be a list of column ids.');
    return this.save({ ...cfg, hiddenColumns: ids.filter((id) => cfg.columns.some((c) => c.id === id)) });
  }

  // ---------- items ----------

  /** Cache-first board. `refresh` fetches from GitHub; on failure the cache is returned marked stale. */
  async board({ refresh = false } = {}): Promise<GithubBoard> {
    let cfg = this.requireConfig();
    const cache = this.readCache();
    if (!refresh && cache) return { project: cfg, ...cache };
    try {
      const fetched = await this.fetchItems(cfg);
      const known = new Set(cfg.columns.map((c) => c.id));
      const unknownStatus = fetched.items.some((i) => i.statusId && !known.has(i.statusId));
      const columnsOld = this.now() - Date.parse(cfg.columnsSyncedAt) > GITHUB_COLUMNS_MAX_AGE_MS;
      if (unknownStatus || columnsOld) cfg = await this.syncColumns();
      writeJson(this.paths.itemsCache, fetched);
      return { project: cfg, ...fetched };
    } catch (err) {
      if (!cache) throw err;
      return { project: cfg, ...cache, stale: { reason: (err as Error).message } };
    }
  }

  async itemDetail(id: string): Promise<GithubItemDetail> {
    const cfg = this.requireConfig();
    const res = await this.gh.graphql<DetailResponse>(itemDetailQuery, { id });
    if (!res.node) throw new Error(`Card ${id} not found.`);
    const item = toItem(res.node, cfg.statusField.id);
    return { item, body: res.node.body?.body ?? '', comments: toComments(res.node.body?.comments) };
  }

  /** Assign or unassign the signed-in user on an issue/PR card. Updates the cache. */
  async setAssigned(itemId: string, assign: boolean): Promise<GithubItem> {
    this.requireConfig();
    const cache = this.readCache();
    const item = cache?.items.find((i) => i.id === itemId) ?? (await this.itemDetail(itemId)).item;
    if (item.type === GithubContentType.DraftIssue || !item.contentId) {
      throw new Error('Draft cards have no assignees on GitHub. Convert it to an issue first.');
    }
    const viewer = await this.viewer();
    await this.gh.graphql(assign ? addAssigneeMutation : removeAssigneeMutation, { assignable: item.contentId, user: viewer.id });
    const others = item.assignees.filter((a) => a.login !== viewer.login);
    const updated: GithubItem = { ...item, assignees: assign ? [...others, { login: viewer.login, avatarUrl: viewer.avatarUrl }] : others };
    if (cache) writeJson(this.paths.itemsCache, { ...cache, items: cache.items.map((i) => (i.id === itemId ? updated : i)) });
    return updated;
  }

  /** Items currently in the cache (for hand-off lookups). */
  cachedItems(): GithubItem[] {
    return this.readCache()?.items ?? [];
  }

  // ---------- internals ----------

  private readCache(): ItemsCache | null {
    return readJson<ItemsCache | null>(this.paths.itemsCache, null);
  }

  private async viewer(): Promise<GithubUser & { id: string }> {
    const res = await this.gh.graphql<{ viewer: GithubUser & { id: string } }>(viewerQuery);
    return res.viewer;
  }

  private async fetchMeta(ownerType: 'org' | 'user', owner: string, number: number) {
    const res = await this.gh.graphql<MetaResponse>(projectMetaQuery(ownerType), { owner, number });
    const project = res.owner?.projectV2;
    if (!project) throw new GhError('Project not found, or you have no access to it.');
    const status = pickStatusField((project.fields?.nodes ?? []).filter((f): f is RawSingleSelectField => !!f));
    if (!status) throw new Error('This project has no single-select field (like "Status") to use as columns.');
    return { projectId: project.id, title: project.title, statusField: { id: status.id, name: status.name }, columns: status.columns };
  }

  private async fetchItems(cfg: GithubProjectConfig): Promise<ItemsCache> {
    const items: GithubItem[] = [];
    let viewer: GithubUser | null = null;
    let after: string | null = null;
    for (let page = 0; page < GITHUB_MAX_PAGES; page++) {
      const res: ItemsResponse = await this.gh.graphql<ItemsResponse>(itemsPageQuery(cfg.ownerType), { owner: cfg.owner, number: cfg.number, after });
      viewer = res.viewer ? { login: res.viewer.login, avatarUrl: res.viewer.avatarUrl } : viewer;
      const conn = res.owner?.projectV2?.items;
      if (!conn) throw new GhError('Project not found, or you have no access to it.');
      for (const raw of conn.nodes) if (raw) items.push(toItem(raw, cfg.statusField.id));
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return { items, viewer, fetchedAt: this.now() };
  }
}
