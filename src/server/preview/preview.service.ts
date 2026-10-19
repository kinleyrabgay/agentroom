import { randomUUID } from 'node:crypto';
import { ServerMessageKind } from '../../shared/enums.js';
import type { BridgeActor, BridgeCmd, PreviewState } from '../../shared/types/index.js';
import { BRIDGE_COMMAND_TIMEOUT_MS, PAGE_RELOAD_TIMEOUT_MS } from '../config/constants.js';
import type { Hub } from '../realtime/hub.js';
import { startProxy, type PreviewProxy } from './proxy.js';
import { resolveUrl, swapOrigin } from './url.js';

type Pending = { resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/**
 * Lightweight in-app browser. Each bot's page runs in an iframe inside the AgentRoom UI,
 * served through a per-site proxy. Bot commands travel server → UI → iframe (postMessage) and back.
 */
export class PreviewService {
  private proxies = new Map<string, PreviewProxy>();
  private pending = new Map<string, Pending>();
  private readyWaiters = new Map<string, Array<() => void>>();
  private controlWaiters = new Map<string, Array<() => void>>();

  constructor(private readonly hub: Hub) {}

  state(botId: string): PreviewState | undefined {
    return this.hub.previews[botId];
  }

  /** Open a URL (absolute, host:port, or a path relative to the current page) in the bot's preview. */
  async open(botId: string, raw: string): Promise<PreviewState> {
    const current = this.state(botId);
    const url = resolveUrl(this.unproxy(raw), current?.target);
    const proxy = await this.proxyFor(url);
    const state: PreviewState = {
      target: url.origin,
      proxy: proxy.origin,
      path: url.pathname + url.search + url.hash,
      title: current?.target === url.origin ? current.title : '',
      nav: (current?.nav ?? 0) + 1,
      humanControl: current?.humanControl ?? false,
    };
    this.hub.preview(botId, state);
    return state;
  }

  close(botId: string) {
    this.setControl(botId, false);
    this.hub.preview(botId, null);
  }

  /** The bridge reported a (re)load or client-side navigation. */
  ready(botId: string, path: string, title: string) {
    const s = this.state(botId);
    if (!s) return;
    this.hub.preview(botId, { ...s, path, title });
    for (const fn of this.readyWaiters.get(botId) ?? []) fn();
    this.readyWaiters.delete(botId);
  }

  waitReady(botId: string, ms = PAGE_RELOAD_TIMEOUT_MS): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      const list = this.readyWaiters.get(botId) ?? [];
      list.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
      this.readyWaiters.set(botId, list);
    });
  }

  /** Run a command inside the bot's page. Requires the AgentRoom UI to be open. */
  command(botId: string, cmd: BridgeCmd, actor: BridgeActor, ms = BRIDGE_COMMAND_TIMEOUT_MS): Promise<string> {
    if (!this.state(botId)) return Promise.reject(new Error('No page is open. Call browser_open first.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The page did not respond (it may be navigating). Try browser_snapshot again.'));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.hub.toPrimary({ kind: ServerMessageKind.BridgeCmd, botId, id, cmd, actor })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('The AgentRoom UI is not open in a browser tab, so the in-app browser is unavailable. Ask the human to open it.'));
      }
    });
  }

  /** A command finished in the page. URLs are reported with the real site's origin, not the proxy's. */
  result(id: string, ok: boolean, result?: string, error?: string) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (ok) p.resolve(this.unproxy(result ?? ''));
    else p.reject(new Error(this.unproxy(error ?? 'command failed')));
  }

  setControl(botId: string, on: boolean) {
    const s = this.state(botId);
    if (s && s.humanControl !== on) this.hub.preview(botId, { ...s, humanControl: on });
    if (!on) {
      for (const fn of this.controlWaiters.get(botId) ?? []) fn();
      this.controlWaiters.delete(botId);
    }
  }

  /** Resolves once the human hands control back (immediately if they don't have it). */
  waitForControl(botId: string, signal?: AbortSignal): Promise<void> {
    if (!this.state(botId)?.humanControl) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const list = this.controlWaiters.get(botId) ?? [];
      list.push(resolve);
      this.controlWaiters.set(botId, list);
      signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  }

  closeAll() {
    for (const p of this.proxies.values()) p.close();
    this.proxies.clear();
  }

  /** Bots may echo proxy URLs back; map them to the real site. */
  private unproxy(text: string): string {
    for (const p of this.proxies.values()) text = swapOrigin(text, p.origin, p.target.origin);
    return text;
  }

  private async proxyFor(url: URL): Promise<PreviewProxy> {
    const existing = this.proxies.get(url.origin);
    if (existing) return existing;
    const proxy = await startProxy(new URL(url.origin));
    this.proxies.set(url.origin, proxy);
    return proxy;
  }
}
