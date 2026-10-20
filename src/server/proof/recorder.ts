import fs from 'node:fs';
import path from 'node:path';
import type { ProofFrame, ProofScenario, ProofScenarioResult, ProofStep } from '../../shared/types/index.js';
import type { A11yIssue, PageMetrics } from './checks.js';
import type { PwBrowser, PwLocator, PwPage } from './browser.js';
import { stepLabel } from './scenario.js';

export const VIEWPORT = { width: 1280, height: 800 };
const STEP_TIMEOUT_MS = 10_000;
const NAV_TIMEOUT_MS = 30_000;

export interface RecordOptions {
  baseUrl: string;
  outDir: string;
  /** File-name prefix ("s0", "before-s0"). */
  prefix: string;
  mask: string[];
  /** Only load each page and screenshot it (the "before" pass), no interactions. */
  pagesOnly?: boolean;
  axe?: string | null;
  signal?: AbortSignal;
}

export interface Recording {
  result: Omit<ProofScenarioResult, 'before' | 'gif'>;
  a11y: A11yIssue[];
  metrics: PageMetrics | null;
  errors: string[];
}

/** Run one scenario in a fresh page, saving a PNG after load and after each step. */
export async function recordScenario(browser: PwBrowser, scenario: ProofScenario, opts: RecordOptions): Promise<Recording> {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  const frames: ProofFrame[] = [];
  let n = 0;
  const shot = async (label: string, step: number, ok: boolean) => {
    const file = `${opts.prefix}-${String(n++).padStart(2, '0')}.png`;
    const mask = opts.mask.map((m) => page.locator(m));
    const png = await page.screenshot({ type: 'png', animations: 'disabled', ...(mask.length ? { mask } : {}) }).catch(() => null);
    if (png) {
      fs.writeFileSync(path.join(opts.outDir, file), png);
      frames.push({ file, label, step, ok });
    }
  };

  let failed: { step: number; error: string } | null = null;
  try {
    await page.goto(new URL(scenario.path ?? '/', opts.baseUrl).href, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await settle(page);
    await shot(scenario.path && scenario.path !== '/' ? `Open ${scenario.path}` : 'Page loaded', -1, true);
    const steps = opts.pagesOnly ? scenario.steps.filter((s) => s.action === 'goto') : scenario.steps;
    for (let i = 0; i < steps.length; i++) {
      if (opts.signal?.aborted) throw new Error('Stopped.');
      const step = steps[i];
      try {
        await runStep(page, step, opts.baseUrl);
        if (step.action !== 'wait' || i === steps.length - 1) await shot(stepLabel(step), i, true);
      } catch (err) {
        failed = { step: i, error: `Step ${i + 1} (${stepLabel(step)}) failed: ${cleanError(err)}` };
        await shot(`Failed: ${stepLabel(step)}`, i, false);
        break;
      }
    }
  } catch (err) {
    failed ??= { step: -1, error: `Couldn't load ${scenario.path ?? '/'}: ${cleanError(err)}` };
  }

  const a11y = failed?.step === -1 ? [] : await audit(page, opts.axe ?? null).catch(() => []);
  const metrics = failed?.step === -1 ? null : await measure(page).catch(() => null);
  await ctx.close().catch(() => {});
  return {
    result: {
      name: scenario.name,
      ok: !failed,
      ...(failed ? { error: failed.error, failedStep: failed.step } : {}),
      frames,
    },
    a11y,
    metrics,
    errors,
  };
}

async function runStep(page: PwPage, step: ProofStep, baseUrl: string) {
  const t = { timeout: STEP_TIMEOUT_MS };
  switch (step.action) {
    case 'goto':
      await page.goto(new URL(step.target!, baseUrl).href, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
      break;
    case 'click':
      await find(page, step.target!).click(t);
      break;
    case 'fill':
      await find(page, step.target!).fill(step.value ?? '', t);
      break;
    case 'press':
      await page.keyboard.press(step.target!);
      break;
    case 'wait': {
      const v = step.value ?? step.target ?? '';
      if (/^\d+$/.test(v)) await page.waitForTimeout(Math.min(Number(v), 5000));
      else if (v) await find(page, step.target ?? `text=${v}`).waitFor({ state: 'visible', ...t });
      break;
    }
    case 'expect': {
      const text = step.value ?? step.target!;
      await page.getByText(text).first().waitFor({ state: 'visible', ...t });
      break;
    }
    case 'screenshot':
      break;
  }
  await settle(page);
}

/** `text=Save` → by text; anything else → CSS (Playwright selector syntax). */
function find(page: PwPage, target: string): PwLocator {
  return target.startsWith('text=') ? page.getByText(target.slice(5)).first() : page.locator(target).first();
}

async function settle(page: PwPage) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(250);
}

function cleanError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  // Playwright errors carry a long call log; the first line says what happened.
  return msg.split('\n')[0].replace(/^(locator|page)\.\w+: /, '').slice(0, 240);
}

/** Paint/transfer numbers from the Performance API (LCP via a buffered observer). */
async function measure(page: PwPage): Promise<PageMetrics | null> {
  return page.evaluate(`(async () => {
    const lcp = await new Promise((resolve) => {
      let last;
      try {
        new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) last = e[e.length - 1].startTime; })
          .observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (e) {}
      setTimeout(() => resolve(last), 300);
    });
    let cls = 0;
    try {
      for (const e of performance.getEntriesByType('layout-shift')) if (!e.hadRecentInput) cls += e.value;
    } catch (e) {}
    const nav = performance.getEntriesByType('navigation')[0];
    const transfer = performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), nav ? nav.transferSize || 0 : 0);
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      lcpMs: lcp ?? (fcp ? fcp.startTime : undefined),
      cls,
      ttfbMs: nav ? nav.responseStart : undefined,
      transferKb: transfer / 1024,
    };
  })()`);
}

/**
 * Accessibility issues on the current page: axe-core when available, otherwise a small set of
 * built-in rules (alt text, names for buttons/links, labels, document language, contrast-free).
 */
export async function audit(page: PwPage, axe: string | null): Promise<A11yIssue[]> {
  if (axe) {
    await page.addScriptTag({ content: axe });
    const out = await page.evaluate<A11yIssue[]>(`(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.flatMap((v) => v.nodes.slice(0, 5).map((n) => ({
        rule: v.id, impact: v.impact || 'moderate', target: String(n.target[0] || '').slice(0, 80), help: v.help,
      })));
    })()`);
    return out;
  }
  return page.evaluate<A11yIssue[]>(`(() => {
    const issues = [];
    const where = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '')).slice(0, 80);
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.getAttribute('title') || '').trim();
    if (!document.documentElement.getAttribute('lang')) issues.push({ rule: 'html-has-lang', impact: 'serious', target: 'html', help: 'The page has no lang attribute' });
    for (const img of document.querySelectorAll('img')) {
      if (visible(img) && !img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation') issues.push({ rule: 'image-alt', impact: 'critical', target: where(img), help: 'Image has no alt text' });
    }
    for (const el of document.querySelectorAll('button, [role=button], a[href]')) {
      if (!visible(el)) continue;
      const hasImgAlt = [...el.querySelectorAll('img[alt], svg[aria-label]')].some((i) => (i.getAttribute('alt') || i.getAttribute('aria-label') || '').trim());
      if (!name(el) && !hasImgAlt) issues.push({ rule: el.tagName === 'A' ? 'link-name' : 'button-name', impact: 'serious', target: where(el), help: (el.tagName === 'A' ? 'Link' : 'Button') + ' has no accessible name' });
    }
    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
      if (!visible(el)) continue;
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
      if (!labelled) issues.push({ rule: 'label', impact: 'critical', target: where(el), help: 'Form field has no label' + (el.getAttribute('placeholder') ? ' (placeholder is not a label)' : '') });
    }
    const ids = new Map();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
    for (const [id, n] of ids) if (n > 1 && document.querySelector('[aria-labelledby~="' + CSS.escape(id) + '"], label[for="' + CSS.escape(id) + '"]')) issues.push({ rule: 'duplicate-id-aria', impact: 'serious', target: '#' + id, help: 'An id used by a label is not unique' });
    return issues.slice(0, 50);
  })()`);
}
