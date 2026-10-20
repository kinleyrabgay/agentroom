import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProofAvailability } from '../../shared/types/index.js';

/** The slice of Playwright's API proof uses (playwright-core is an optional dependency). */
export interface PwLocator {
  first(): PwLocator;
  click(opts?: { timeout?: number }): Promise<void>;
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  waitFor(opts?: { state?: 'visible' | 'attached'; timeout?: number }): Promise<void>;
}
export interface PwPage {
  goto(url: string, opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>;
  locator(selector: string): PwLocator;
  getByText(text: string, opts?: { exact?: boolean }): PwLocator;
  keyboard: { press(key: string): Promise<void> };
  screenshot(opts?: { fullPage?: boolean; type?: 'png'; mask?: PwLocator[]; animations?: 'disabled' }): Promise<Buffer>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', opts?: { timeout?: number }): Promise<void>;
  evaluate<T>(fn: string | ((arg: never) => T), arg?: unknown): Promise<T>;
  addScriptTag(opts: { content?: string; path?: string }): Promise<unknown>;
  url(): string;
  on(event: 'pageerror', fn: (err: Error) => void): void;
  on(event: 'console', fn: (msg: { type(): string; text(): string }) => void): void;
  close(): Promise<void>;
}
export interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
export interface PwBrowser {
  newContext(opts?: { viewport?: { width: number; height: number }; deviceScaleFactor?: number; colorScheme?: 'light' | 'dark' }): Promise<PwContext>;
  close(): Promise<void>;
  version(): string;
}
interface Playwright {
  chromium: { launch(opts: { headless: boolean; channel?: string; executablePath?: string; args?: string[] }): Promise<PwBrowser> };
}

const MODULE = 'playwright-core';
let cached: Playwright | undefined;

/**
 * Load playwright-core if it's installed (it's optional, so AgentRoom stays small without it):
 * next to AgentRoom (incl. a global install), else in the project.
 */
export async function loadPlaywright(projectRoot = process.cwd()): Promise<Playwright | null> {
  if (cached) return cached;
  const tries: (() => Promise<unknown>)[] = [
    () => import(/* @vite-ignore */ MODULE),
    () => import(/* @vite-ignore */ pathToFileURL(createRequire(path.join(projectRoot, 'noop.js')).resolve(MODULE)).href),
  ];
  for (const t of tries) {
    try {
      const mod = (await t()) as Playwright & { default?: Playwright };
      const pw = mod.chromium ? mod : (mod.default ?? null);
      if (pw?.chromium) return (cached = pw);
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** Chrome/Chromium/Edge installed on this machine, if any (AGENTROOM_CHROME wins). */
export function findChrome(): string | null {
  const env = process.env.AGENTROOM_CHROME;
  if (env && fs.existsSync(env)) return env;
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        ]
      : process.platform === 'win32'
        ? [
            path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Can this machine record proof? (Used by the Verify phase, the Proof tab and `agentroom doctor`.) */
export async function proofAvailability(projectRoot?: string): Promise<ProofAvailability> {
  const pw = await loadPlaywright(projectRoot);
  if (!pw) return { ok: false, reason: 'Install playwright-core to record proof: npm i -g playwright-core (or add it to the project).' };
  const chrome = findChrome();
  if (!chrome) return { ok: false, reason: 'No Chrome, Chromium or Edge found. Install Chrome, or set AGENTROOM_CHROME to a browser binary.' };
  return { ok: true, browser: path.basename(chrome) };
}

/** Start a headless browser for a proof run. */
export async function launchBrowser(projectRoot?: string): Promise<PwBrowser> {
  const pw = await loadPlaywright(projectRoot);
  if (!pw) throw new Error('playwright-core is not installed.');
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome, Chromium or Edge found.');
  return pw.chromium.launch({ headless: true, executablePath: chrome, args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] });
}

/** axe-core's source, when installed next to AgentRoom or in the project (optional, better rules than the built-in ones). */
export function axeSource(projectRoot: string): string | null {
  for (const base of [projectRoot, path.dirname(new URL(import.meta.url).pathname)]) {
    try {
      const req = createRequire(path.join(base, 'noop.js'));
      return fs.readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
    } catch {
      /* try the next */
    }
  }
  return null;
}
