import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FindingCategory, FindingSeverity, FindingSource } from '../../../shared/enums.js';
import type { FileDiff } from '../diff.js';
import type { FindingDraft } from '../types.js';
import { changedDependencies, MANIFEST, type DependencyChange } from './manifest.js';
import { typosquatOf } from './typosquat.js';

export interface CommandResult {
  stdout: string;
  /** Non-zero exit is normal for `npm audit` with vulnerabilities; `error` is set only when it couldn't run. */
  error?: string;
}

export type CommandRunner = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<CommandResult>;
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const execRunner: CommandRunner = (cmd, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      // Commands that ran but exited non-zero still produced useful stdout.
      const ran = !err || typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number';
      resolve(ran ? { stdout: String(stdout) } : { stdout: String(stdout ?? ''), error: err.message.split('\n')[0] });
    });
  });

const OSV_URL = 'https://api.osv.dev/v1/querybatch';
const AUDIT_TIMEOUT_MS = 60_000;
const OSV_TIMEOUT_MS = 10_000;
const VIEW_TIMEOUT_MS = 15_000;
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];

export interface DependencyGuardDeps {
  cwd: string;
  run?: CommandRunner;
  fetch?: HttpFetch;
}

/**
 * Runs when a change touches a manifest or lockfile: npm audit, OSV for new/changed packages,
 * typosquat detection, and install-script detection. Infrastructure failures become an Info
 * finding ("check incomplete") — they never block.
 */
export class DependencyGuard {
  private readonly run: CommandRunner;
  private readonly fetch: HttpFetch;

  constructor(private readonly deps: DependencyGuardDeps) {
    this.run = deps.run ?? execRunner;
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
  }

  touchesManifests(files: FileDiff[]): boolean {
    return files.some((f) => MANIFEST.test(f.path));
  }

  async check(files: FileDiff[]): Promise<FindingDraft[]> {
    if (!this.touchesManifests(files)) return [];
    const changes = changedDependencies(files, (manifest, name) => this.lockVersion(manifest, name));
    const incomplete: string[] = [];
    const out: FindingDraft[] = [];

    for (const c of changes) {
      const twin = typosquatOf(c.name);
      if (twin) {
        out.push(this.draft(FindingSeverity.Warning, FindingCategory.Typosquat, 'dep.typosquat', `Possible typosquat: ${c.name}`,
          `\`${c.name}\` is one or two characters away from the popular package \`${twin}\`. Make sure this is the package you meant; typosquats often steal credentials on install.`, c));
      }
    }

    const [audit, osv, scripts] = await Promise.all([
      this.audit().catch((e: Error) => (incomplete.push(`npm audit: ${e.message}`), [])),
      this.osv(changes).catch((e: Error) => (incomplete.push(`OSV: ${e.message}`), [])),
      this.installScripts(changes).catch((e: Error) => (incomplete.push(`install scripts: ${e.message}`), [])),
    ]);
    out.push(...audit, ...osv, ...scripts);

    if (incomplete.length) {
      out.push({
        severity: FindingSeverity.Info,
        category: FindingCategory.Vulnerability,
        source: FindingSource.Dependency,
        rule: 'dep.incomplete',
        title: 'Dependency check incomplete',
        detail: `Some dependency checks could not run:\n${incomplete.map((m) => `- ${m}`).join('\n')}`,
      });
    }
    return out;
  }

  private draft(severity: FindingSeverity, category: FindingCategory, rule: string, title: string, detail: string, c?: DependencyChange): FindingDraft {
    return {
      severity,
      category,
      source: FindingSource.Dependency,
      rule,
      title,
      detail,
      ...(c ? { file: c.manifest, snippet: `${c.name}@${c.version || c.range}` } : {}),
    };
  }

  private async audit(): Promise<FindingDraft[]> {
    if (!fs.existsSync(path.join(this.deps.cwd, 'package-lock.json')) && !fs.existsSync(path.join(this.deps.cwd, 'npm-shrinkwrap.json'))) return [];
    const res = await this.run('npm', ['audit', '--json'], { cwd: this.deps.cwd, timeoutMs: AUDIT_TIMEOUT_MS });
    if (res.error) throw new Error(res.error);
    let report: { vulnerabilities?: Record<string, { severity?: string; via?: unknown[]; fixAvailable?: unknown; range?: string }> };
    try {
      report = JSON.parse(res.stdout || '{}');
    } catch {
      throw new Error('unreadable output');
    }
    const out: FindingDraft[] = [];
    for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
      const sev = v.severity ?? 'low';
      if (sev !== 'critical' && sev !== 'high' && sev !== 'moderate') continue;
      const advisories = (v.via ?? []).filter((x): x is { title?: string; url?: string } => typeof x === 'object' && x !== null);
      const lines = advisories.map((a) => `- ${a.title ?? 'advisory'}${a.url ? ` (${a.url})` : ''}`);
      out.push(this.draft(sev === 'moderate' ? FindingSeverity.Warning : FindingSeverity.Critical, FindingCategory.Vulnerability, 'dep.npm-audit',
        `${name}: ${sev} vulnerability`,
        `npm audit reports a ${sev} vulnerability in \`${name}\`${v.range ? ` (${v.range})` : ''}.\n${lines.join('\n')}\n\n${v.fixAvailable ? 'A fix is available: run `npm audit fix` or upgrade.' : 'No automatic fix; consider an alternative or pin a patched version.'}`,
        { name, range: v.range ?? '', version: '', manifest: 'package-lock.json' }));
    }
    return out;
  }

  private async osv(changes: DependencyChange[]): Promise<FindingDraft[]> {
    const queries = changes.filter((c) => c.version);
    if (!queries.length) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSV_TIMEOUT_MS);
    try {
      const res = await this.fetch(OSV_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queries: queries.map((c) => ({ package: { name: c.name, ecosystem: 'npm' }, version: c.version })) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
      const out: FindingDraft[] = [];
      (body.results ?? []).forEach((r, i) => {
        const ids = (r.vulns ?? []).map((v) => v.id);
        if (!ids.length) return;
        const c = queries[i];
        out.push(this.draft(FindingSeverity.Critical, FindingCategory.Vulnerability, 'dep.osv', `${c.name}@${c.version} has known vulnerabilities`,
          `OSV lists ${ids.length} known ${ids.length === 1 ? 'vulnerability' : 'vulnerabilities'} for \`${c.name}@${c.version}\`:\n${ids.slice(0, 10).map((id) => `- [${id}](https://osv.dev/vulnerability/${id})`).join('\n')}\n\nUpgrade to a patched version.`, c));
      });
      return out;
    } catch (err) {
      throw new Error((err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  private async installScripts(changes: DependencyChange[]): Promise<FindingDraft[]> {
    const out: FindingDraft[] = [];
    const errors: string[] = [];
    await Promise.all(
      changes.map(async (c) => {
        const spec = c.version ? `${c.name}@${c.version}` : c.name;
        const res = await this.run('npm', ['view', spec, 'scripts', '--json'], { cwd: this.deps.cwd, timeoutMs: VIEW_TIMEOUT_MS });
        if (res.error) return void errors.push(res.error);
        let scripts: Record<string, string> = {};
        try {
          scripts = res.stdout.trim() ? JSON.parse(res.stdout) : {};
        } catch {
          return;
        }
        const hooks = INSTALL_HOOKS.filter((h) => typeof scripts?.[h] === 'string');
        if (!hooks.length) return;
        out.push(this.draft(FindingSeverity.Warning, FindingCategory.InstallScript, 'dep.install-script', `${c.name} runs code on install`,
          `\`${spec}\` defines ${hooks.map((h) => `\`${h}\``).join(', ')}:\n${hooks.map((h) => `- ${h}: \`${scripts[h]}\``).join('\n')}\n\nInstall scripts run with your permissions. Make sure you trust this package.`, c));
      }),
    );
    if (errors.length && !out.length && errors.length === changes.length) throw new Error(errors[0]);
    return out;
  }

  /** Locked version of a dependency from package-lock.json next to the manifest. */
  private lockVersion(manifest: string, name: string): string | null {
    try {
      const lock = JSON.parse(fs.readFileSync(path.join(this.deps.cwd, path.dirname(manifest), 'package-lock.json'), 'utf8'));
      return lock.packages?.[`node_modules/${name}`]?.version ?? lock.dependencies?.[name]?.version ?? null;
    } catch {
      return null;
    }
  }
}
