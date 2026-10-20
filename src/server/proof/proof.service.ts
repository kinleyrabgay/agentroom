import fs from 'node:fs';
import path from 'node:path';
import type { Goal, ProofCheck, ProofReport, ProofScenario, ProofScenarioResult, ProofView, Settings } from '../../shared/types/index.js';
import * as gg from '../git/goal-git.js';
import { axeSource, launchBrowser, proofAvailability } from './browser.js';
import { a11yCheck, bundleBytes, bundleCheck, coverageCheck, perfCheck, readCoverage, visualCheck, type A11yIssue, type PageMetrics } from './checks.js';
import { detectApp, startApp, type RunningApp } from './devserver.js';
import { decodePng, diffPercent, encodeGif } from './image.js';
import { PROOF_BRANCH, publishProof, rawUrl } from './publish.js';
import { recordScenario } from './recorder.js';
import { cleanScenario, defaultScenarios } from './scenario.js';

export interface ProofServiceDeps {
  root: string;
  /** `.agentroom/runs`. */
  runsDir: string;
  settings: () => Settings;
  /** Folder for throwaway "before" checkouts. */
  scratchDir: string;
}

/** What a run needs from the goal. */
export interface ProofTarget {
  goal: Goal;
  /** The goal's folder (worktree) — the "after" side. */
  cwd: string;
}

const FILE_RE = /^[A-Za-z0-9._-]+\.(png|gif|json)$/;
/** Marker the PR body uses until images are published (replaced at PR time). */
export const PROOF_MARK = '<!-- agentroom:proof -->';

/**
 * Proof of work: start the app from the goal's folder, run scenarios in a headless browser,
 * save frames + a GIF, and run quality checks against the goal's starting commit.
 */
export class ProofService {
  private running = new Map<string, AbortController>();

  constructor(private readonly deps: ProofServiceDeps) {}

  dir(goalId: string) {
    return path.join(this.deps.runsDir, 'proof', safeId(goalId));
  }

  isRunning(goalId: string) {
    return this.running.has(goalId);
  }

  stop(goalId: string) {
    this.running.get(goalId)?.abort();
  }

  report(goalId: string): ProofReport | null {
    return readJson<ProofReport>(path.join(this.dir(goalId), 'report.json'));
  }

  scenarios(goalId: string): ProofScenario[] {
    return readJson<ProofScenario[]>(path.join(this.dir(goalId), 'scenarios.json')) ?? [];
  }

  /** Save the scenarios to run (from the QA bot or the human). Returns the cleaned list. */
  setScenarios(goalId: string, list: unknown): ProofScenario[] {
    if (!Array.isArray(list)) throw new Error('Send a list of scenarios.');
    const clean = list.map(cleanScenario).filter((s): s is ProofScenario => !!s);
    if (list.length && !clean.length) throw new Error('None of those scenarios are usable: each needs a name, a path on the app ("/…") and valid steps.');
    fs.mkdirSync(this.dir(goalId), { recursive: true });
    fs.writeFileSync(path.join(this.dir(goalId), 'scenarios.json'), JSON.stringify(clean, null, 2) + '\n');
    return clean;
  }

  async view(goalId: string): Promise<ProofView> {
    return { report: this.report(goalId), scenarios: this.scenarios(goalId), availability: await proofAvailability(this.deps.root), running: this.isRunning(goalId) };
  }

  /** A file from the goal's proof folder (frames, GIF), or null. */
  file(goalId: string, name: string): { path: string; type: string } | null {
    if (!FILE_RE.test(name)) return null;
    const p = path.join(this.dir(goalId), name);
    if (!fs.existsSync(p)) return null;
    return { path: p, type: name.endsWith('.gif') ? 'image/gif' : name.endsWith('.png') ? 'image/png' : 'application/json' };
  }

  /** Whether the goal has something to verify in a browser (a web app we can start or a URL). */
  hasApp(cwd: string): boolean {
    const s = this.deps.settings().proof;
    return !!s.url.trim() || !!detectApp(cwd, s.devCommand);
  }

  /** Record proof and run quality checks. Never throws: problems become a skipped/error report. */
  async run(target: ProofTarget, scenarios: ProofScenario[], onProgress?: (line: string) => void): Promise<ProofReport> {
    const { goal, cwd } = target;
    if (this.running.has(goal.id)) throw new Error(`Proof for ${goal.id} is already running.`);
    const abort = new AbortController();
    this.running.set(goal.id, abort);
    const startedAt = new Date().toISOString();
    const out = this.dir(goal.id);
    const report: ProofReport = { goalId: goal.id, round: goal.round, status: 'passed', startedAt, finishedAt: startedAt, scenarios: [], checks: [] };
    const settings = this.deps.settings();
    const cleanups: (() => Promise<void>)[] = [];
    try {
      const avail = await proofAvailability(this.deps.root);
      if (!avail.ok) return this.finish({ ...report, status: 'skipped', reason: avail.reason });
      const app = detectApp(cwd, settings.proof.devCommand);
      if (!app && !settings.proof.url.trim()) return this.finish({ ...report, status: 'skipped', reason: 'No web app to open: no dev/start script in package.json and no proof URL in Settings → Proof.' });

      resetDir(out, ['scenarios.json']);
      const list = scenarios.length ? scenarios : defaultScenarios();
      this.setScenarios(goal.id, list);

      onProgress?.('Starting the app');
      let head: RunningApp | null = null;
      if (settings.proof.url.trim()) report.url = settings.proof.url.trim();
      else {
        head = await startApp(cwd, app!, { timeoutSec: settings.proof.startTimeoutSec, signal: abort.signal });
        cleanups.push(head.stop);
        report.url = head.url;
      }

      const browser = await launchBrowser(this.deps.root);
      cleanups.push(() => browser.close().catch(() => {}));
      const axe = settings.quality.a11y ? axeSource(this.deps.root) : null;

      const a11yHead: A11yIssue[] = [];
      let metrics: PageMetrics | null = null;
      for (let i = 0; i < list.length; i++) {
        onProgress?.(`Recording "${list[i].name}"`);
        const rec = await recordScenario(browser, list[i], { baseUrl: report.url!, outDir: out, prefix: `s${i}`, mask: settings.proof.mask, axe, signal: abort.signal });
        a11yHead.push(...rec.a11y);
        metrics ??= rec.metrics;
        const result: ProofScenarioResult = { ...rec.result, before: [] };
        if (rec.errors.length && result.ok) result.error = `Page errors: ${rec.errors.slice(0, 2).join(' · ')}`;
        const gif = this.gif(out, `s${i}.gif`, result.frames.map((f) => f.file));
        if (gif) result.gif = gif;
        report.scenarios.push(result);
      }

      // Before: the same pages on the goal's starting commit (only when we start the app ourselves).
      let a11yBase: A11yIssue[] | null = null;
      const visual: { label: string; pct: number }[] = [];
      const base = goal.baseRef && app && !settings.proof.url.trim() && (settings.proof.before || settings.quality.visual || settings.quality.a11y) ? await this.baseFolder(goal, abort.signal).catch(() => null) : null;
      if (base) {
        cleanups.push(base.remove);
        try {
          onProgress?.('Recording the starting commit');
          const before = await startApp(base.dir, detectApp(base.dir, settings.proof.devCommand) ?? app!, { timeoutSec: settings.proof.startTimeoutSec, signal: abort.signal });
          cleanups.push(before.stop);
          a11yBase = [];
          for (let i = 0; i < list.length; i++) {
            const rec = await recordScenario(browser, list[i], { baseUrl: before.url, outDir: out, prefix: `before-s${i}`, mask: settings.proof.mask, axe, pagesOnly: true, signal: abort.signal });
            a11yBase.push(...rec.a11y);
            const r = report.scenarios[i];
            r.before = rec.result.frames;
            visual.push(...pairDiffs(out, r, rec.result.frames));
          }
        } catch (err) {
          onProgress?.(`Starting commit skipped: ${(err as Error).message.split('\n')[0]}`);
        }
      }

      const q = settings.quality;
      const checks: ProofCheck[] = [];
      if (q.a11y) checks.push(a11yCheck(a11yHead, a11yBase, q));
      if (q.perf) checks.push(perfCheck(metrics, q));
      if (q.visual) checks.push(visualCheck(visual, q));
      if (q.coverage || q.bundle) checks.push(...(await this.commandChecks(cwd, base?.dir ?? null, settings, abort.signal, onProgress)));
      report.checks = checks;
      report.status = report.scenarios.every((s) => s.ok) ? 'passed' : 'failed';
      return this.finish(report);
    } catch (err) {
      return this.finish({ ...report, status: 'error', reason: (err as Error).message.slice(0, 600) });
    } finally {
      for (const c of cleanups.reverse()) await c().catch(() => {});
      this.running.delete(goal.id);
    }
  }

  /** Markdown "Proof" section for a PR. With `published`, images link to the proof branch; else a marker is left. */
  markdown(goalId: string, ownerRepo?: string): string | null {
    const r = this.report(goalId);
    if (!r || r.status === 'skipped') return null;
    const lines: string[] = ['### Proof'];
    const img = (file: string, alt: string) => (r.published && ownerRepo ? `![${alt}](${rawUrl(ownerRepo, r.published.sha, `${r.published.base}/${file}`)})` : null);
    for (const s of r.scenarios) {
      lines.push(`**${s.ok ? '✅' : '❌'} ${s.name}**${s.error ? ` — ${s.error}` : ''}`);
      const gif = s.gif ? img(s.gif, s.name) : null;
      if (gif) lines.push(gif);
      const last = s.frames[s.frames.length - 1];
      const before = s.before[0];
      if (before && last) {
        const b = img(before.file, 'Before');
        const a = img(last.file, 'After');
        if (a && b) lines.push(`| Before | After |\n|---|---|\n| ${b} | ${a} |`);
      }
    }
    if (r.checks.length) {
      lines.push('| Check | Result |\n|---|---|\n' + r.checks.map((c) => `| ${icon(c.status)} ${c.label} | ${c.summary.replace(/\|/g, '\\|')} |`).join('\n'));
    }
    if (!r.published) lines.push(PROOF_MARK);
    return lines.join('\n\n');
  }

  /** Push the goal's frames and GIFs to the proof branch (when publishing is on). Returns the updated report. */
  async publish(goalId: string, opts: { push?: boolean } = {}): Promise<ProofReport | null> {
    const r = this.report(goalId);
    if (!r || r.status === 'skipped' || this.deps.settings().proof.publish !== 'branch') return r;
    const dir = this.dir(goalId);
    const names = new Set<string>();
    for (const s of r.scenarios) {
      if (s.gif) names.add(s.gif);
      if (s.frames.length) names.add(s.frames[s.frames.length - 1].file);
      if (s.before[0]) names.add(s.before[0].file);
    }
    const files = [...names].filter((n) => fs.existsSync(path.join(dir, n))).map((name) => ({ name, path: path.join(dir, name) }));
    if (!files.length) return r;
    const folder = `${safeId(goalId)}-r${r.round}`;
    const sha = await publishProof(this.deps.root, folder, files, `Proof for ${goalId} (round ${r.round})`, { push: opts.push ?? true });
    const next = { ...r, published: { branch: PROOF_BRANCH, sha, base: folder } };
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(next, null, 2) + '\n');
    return next;
  }

  // ---------- internals ----------

  private finish(report: ProofReport): ProofReport {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(this.dir(report.goalId), { recursive: true });
    fs.writeFileSync(path.join(this.dir(report.goalId), 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  }

  private gif(dir: string, name: string, frames: string[]): string | undefined {
    if (!frames.length) return undefined;
    try {
      const bitmaps = frames.map((f) => decodePng(fs.readFileSync(path.join(dir, f))));
      fs.writeFileSync(path.join(dir, name), encodeGif(bitmaps, { maxWidth: 960 }));
      return name;
    } catch {
      return undefined;
    }
  }

  private async baseFolder(goal: Goal, signal: AbortSignal): Promise<{ dir: string; remove: () => Promise<void> } | null> {
    if (!goal.baseRef || signal.aborted || !(await gg.isRepo(this.deps.root))) return null;
    const dir = path.join(this.deps.scratchDir, `${safeId(goal.id)}-before`);
    await gg.createDetachedWorktree(this.deps.root, dir, goal.baseRef);
    return { dir, remove: () => gg.removeWorktree(this.deps.root, dir) };
  }

  /** Coverage and bundle size: run the configured commands on both sides. */
  private async commandChecks(cwd: string, baseDir: string | null, settings: Settings, signal: AbortSignal, onProgress?: (line: string) => void): Promise<ProofCheck[]> {
    const q = settings.quality;
    const checks: ProofCheck[] = [];
    if (q.coverage) {
      if (!q.coverageCommand.trim()) checks.push(coverageCheck(null, null, q, 'Set a coverage command in Settings → Quality'));
      else {
        onProgress?.('Measuring coverage');
        const head = await shell(q.coverageCommand, cwd, signal);
        const headPct = readCoverage(cwd);
        const basePct = baseDir && (await shell(q.coverageCommand, baseDir, signal)).ok ? readCoverage(baseDir) : null;
        checks.push(coverageCheck(headPct, basePct, q, !head.ok && headPct === null ? `Coverage command failed: ${head.tail}` : undefined));
      }
    }
    if (q.bundle) {
      if (!q.buildCommand.trim()) checks.push(bundleCheck(null, null, q, 'Set a build command in Settings → Quality'));
      else {
        onProgress?.('Measuring bundle size');
        const head = await shell(q.buildCommand, cwd, signal);
        const headBytes = head.ok ? bundleBytes(cwd, q.bundleDir) : null;
        const baseBytes = baseDir && (await shell(q.buildCommand, baseDir, signal)).ok ? bundleBytes(baseDir, q.bundleDir) : null;
        checks.push(bundleCheck(headBytes, baseBytes, q, !head.ok ? `Build failed: ${head.tail}` : undefined));
      }
    }
    return checks;
  }
}

/** Visual diff of each scenario's "before" page against the matching "after" frame. */
function pairDiffs(dir: string, r: ProofScenarioResult, before: ProofScenarioResult['frames']): { label: string; pct: number }[] {
  const out: { label: string; pct: number }[] = [];
  const after = r.frames.filter((f) => f.step === -1 || /^Open /.test(f.label));
  before.forEach((b, i) => {
    const a = after[i];
    if (!a) return;
    try {
      const pct = diffPercent(decodePng(fs.readFileSync(path.join(dir, b.file))), decodePng(fs.readFileSync(path.join(dir, a.file))));
      out.push({ label: `${r.name} · ${a.label}`, pct });
    } catch {
      /* unreadable frame */
    }
  });
  return out;
}

async function shell(command: string, cwd: string, signal: AbortSignal): Promise<{ ok: boolean; tail: string }> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: string[] = [];
    const keep = (b: Buffer) => {
      lines.push(...b.toString().split('\n').filter(Boolean));
      if (lines.length > 20) lines.splice(0, lines.length - 20);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
    const onAbort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve({ ok: code === 0, tail: lines.slice(-3).join(' ').slice(0, 300) });
    });
  });
}

function resetDir(dir: string, keep: string[]) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (!keep.includes(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');
const icon = (s: ProofCheck['status']) => (s === 'pass' ? '✅' : s === 'warn' ? '⚠️' : s === 'fail' ? '❌' : '⏭️');

