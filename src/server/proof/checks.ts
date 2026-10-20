import fs from 'node:fs';
import path from 'node:path';
import type { ProofCheck, ProofReport, ProofSummary, RiskAssessment, Settings } from '../../shared/types/index.js';
import { riskLevel } from '../security/risk.js';

export type QualitySettings = Settings['quality'];

/** One accessibility issue found on a page (axe-core or the built-in rules). */
export interface A11yIssue {
  rule: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  /** Short description of where: "img.hero", "button#save". */
  target: string;
  help: string;
}

export interface PageMetrics {
  lcpMs?: number;
  cls?: number;
  ttfbMs?: number;
  transferKb?: number;
}

/** Accessibility: only serious/critical issues count, compared with the starting commit when we have it. */
export function a11yCheck(head: A11yIssue[], base: A11yIssue[] | null, q: QualitySettings): ProofCheck {
  const serious = (l: A11yIssue[]) => l.filter((i) => i.impact === 'serious' || i.impact === 'critical');
  const now = serious(head);
  const key = (i: A11yIssue) => `${i.rule}|${i.target}`;
  const before = base ? new Set(serious(base).map(key)) : null;
  const added = before ? now.filter((i) => !before.has(key(i))) : now;
  const details = added.slice(0, 8).map((i) => `${i.rule}: ${i.help} (${i.target})`);
  if (!before) {
    return {
      id: 'a11y',
      label: 'Accessibility',
      status: now.length ? 'warn' : 'pass',
      summary: now.length ? `${now.length} serious ${plural(now.length, 'issue')} (no baseline to compare)` : 'No serious issues',
      value: now.length,
      details,
    };
  }
  const fail = added.length > q.maxNewA11yIssues;
  return {
    id: 'a11y',
    label: 'Accessibility',
    status: fail ? 'fail' : added.length ? 'warn' : 'pass',
    summary: added.length ? `${added.length} new serious ${plural(added.length, 'issue')}` : now.length ? `No new issues (${now.length} already there)` : 'No serious issues',
    value: now.length,
    base: serious(base!).length,
    threshold: q.maxNewA11yIssues,
    details,
  };
}

/** Performance on the dev server is noisy, so it can only warn. */
export function perfCheck(m: PageMetrics | null, q: QualitySettings): ProofCheck {
  if (!m || m.lcpMs === undefined) return { id: 'perf', label: 'Performance', status: 'skipped', summary: 'No paint timing from the page' };
  const parts = [`LCP ${secs(m.lcpMs)}`];
  if (m.cls !== undefined) parts.push(`CLS ${m.cls.toFixed(2)}`);
  if (m.transferKb !== undefined) parts.push(`${Math.round(m.transferKb)} KB`);
  return {
    id: 'perf',
    label: 'Performance',
    status: m.lcpMs > q.maxLcpMs || (m.cls ?? 0) > 0.25 ? 'warn' : 'pass',
    summary: `${parts.join(' · ')} (dev server)`,
    value: Math.round(m.lcpMs),
    threshold: q.maxLcpMs,
  };
}

/** Visual change per page against the starting commit. Expected for UI work, so it only asks for a look. */
export function visualCheck(diffs: { label: string; pct: number }[], q: QualitySettings): ProofCheck {
  if (!diffs.length) return { id: 'visual', label: 'Visual change', status: 'skipped', summary: 'No before/after pairs' };
  const big = diffs.filter((d) => d.pct > q.maxVisualDiffPct);
  const max = Math.max(...diffs.map((d) => d.pct));
  return {
    id: 'visual',
    label: 'Visual change',
    status: big.length ? 'warn' : 'pass',
    summary: big.length ? `${big.length} ${plural(big.length, 'page')} changed a lot (up to ${max}%); take a look` : `Up to ${max}% of pixels changed`,
    value: max,
    threshold: q.maxVisualDiffPct,
    details: diffs.map((d) => `${d.label}: ${d.pct}%`),
  };
}

export function coverageCheck(head: number | null, base: number | null, q: QualitySettings, error?: string): ProofCheck {
  if (error) return { id: 'coverage', label: 'Coverage', status: 'warn', summary: error };
  if (head === null) return { id: 'coverage', label: 'Coverage', status: 'skipped', summary: 'No coverage report found' };
  if (base === null) return { id: 'coverage', label: 'Coverage', status: 'pass', summary: `${head.toFixed(1)}% lines (no baseline)`, value: head };
  const delta = Math.round((head - base) * 10) / 10;
  return {
    id: 'coverage',
    label: 'Coverage',
    status: -delta > q.maxCoverageDrop ? 'fail' : 'pass',
    summary: `${head.toFixed(1)}% lines (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`,
    value: head,
    base,
    threshold: q.maxCoverageDrop,
  };
}

export function bundleCheck(headBytes: number | null, baseBytes: number | null, q: QualitySettings, error?: string): ProofCheck {
  if (error) return { id: 'bundle', label: 'Bundle size', status: 'warn', summary: error };
  if (headBytes === null) return { id: 'bundle', label: 'Bundle size', status: 'skipped', summary: 'No build output found' };
  if (baseBytes === null || baseBytes === 0) return { id: 'bundle', label: 'Bundle size', status: 'pass', summary: `${kb(headBytes)} (no baseline)`, value: headBytes };
  const pct = Math.round(((headBytes - baseBytes) / baseBytes) * 1000) / 10;
  return {
    id: 'bundle',
    label: 'Bundle size',
    status: pct > q.maxBundleGrowthPct ? 'fail' : 'pass',
    summary: `${kb(headBytes)} (${pct >= 0 ? '+' : ''}${pct}%)`,
    value: headBytes,
    base: baseBytes,
    threshold: q.maxBundleGrowthPct,
  };
}

/** Line coverage from istanbul's coverage-summary.json or an lcov.info, under `dir`. */
export function readCoverage(dir: string): number | null {
  const summary = ['coverage/coverage-summary.json', 'coverage-summary.json'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (summary) {
    try {
      const pct = JSON.parse(fs.readFileSync(summary, 'utf8'))?.total?.lines?.pct;
      if (typeof pct === 'number') return pct;
    } catch {
      /* fall through to lcov */
    }
  }
  const lcov = ['coverage/lcov.info', 'lcov.info'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!lcov) return null;
  let found = 0;
  let hit = 0;
  for (const line of fs.readFileSync(lcov, 'utf8').split('\n')) {
    if (line.startsWith('LF:')) found += Number(line.slice(3)) || 0;
    else if (line.startsWith('LH:')) hit += Number(line.slice(3)) || 0;
  }
  return found ? Math.round((hit / found) * 1000) / 10 : null;
}

/** Common build output folders, most specific first. */
const BUILD_DIRS = ['.next/static', 'dist', 'build', 'out', '.output/public'];

/** Total size of JS and CSS under the build output (maps excluded). */
export function bundleBytes(dir: string, configured = ''): number | null {
  const root = configured ? path.join(dir, configured) : BUILD_DIRS.map((d) => path.join(dir, d)).find((d) => fs.existsSync(d));
  if (!root || !fs.existsSync(root)) return null;
  let total = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 12) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'cache') walk(p, depth + 1);
      } else if (/\.(m?js|css)$/.test(e.name)) total += fs.statSync(p).size;
    }
  };
  walk(root, 0);
  return total;
}

/** Checks that stop the goal (gate on). */
export const failing = (checks: ProofCheck[]) => checks.filter((c) => c.status === 'fail');

/** Points each failing quality check adds to the risk score. */
export const QUALITY_POINTS = 10;
export const QUALITY_FACTOR = 'Quality';

/** Fold the last proof run's failing checks into a risk assessment (replacing older quality factors). */
export function withQuality(risk: RiskAssessment, proof: ProofSummary | undefined): RiskAssessment {
  const factors = risk.factors.filter((f) => !f.label.startsWith(QUALITY_FACTOR));
  if (proof?.failing.length) factors.push({ label: `${QUALITY_FACTOR}: ${proof.failing.join(', ')}`, points: Math.min(20, proof.failing.length * QUALITY_POINTS) });
  if (proof?.status === 'failed' && !proof.failing.length) factors.push({ label: `${QUALITY_FACTOR}: the feature didn't work in the browser`, points: 15 });
  const score = Math.min(100, factors.reduce((n, f) => n + f.points, 0));
  return { ...risk, factors, score, level: riskLevel(score) };
}

/** What the goal keeps from a report. */
export function summarize(report: ProofReport): ProofSummary {
  const fails = failing(report.checks);
  const broken = report.scenarios.filter((s) => !s.ok);
  const passedSteps = report.scenarios.reduce((n, s) => n + s.frames.filter((f) => f.ok).length, 0);
  let summary: string;
  if (report.status === 'skipped' || report.status === 'error') summary = report.reason ?? report.status;
  else if (broken.length) summary = `${broken[0].name}: ${broken[0].error ?? 'failed'}`;
  else summary = `${report.scenarios.length} ${plural(report.scenarios.length, 'scenario')} passed (${passedSteps} ${plural(passedSteps, 'step')})${fails.length ? `; ${fails.map((c) => c.summary).join('; ')}` : ''}`;
  return {
    round: report.round,
    status: report.status,
    at: report.finishedAt,
    summary: summary.slice(0, 300),
    failing: fails.map((c) => c.label),
    ...(report.scenarios.some((s) => s.gif) ? { gif: true } : {}),
  };
}

const plural = (n: number, w: string) => (n === 1 ? w : `${w}s`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
