import { z } from 'zod';
import { AgentEventType, BotStatus, BridgeOp, HostTool } from '../../../shared/enums.js';
import type { Bot, BridgeCmd } from '../../../shared/types/index.js';
import {
  ACTION_SETTLE_MS,
  BRIDGE_QUICK_SNAPSHOT_MS,
  PAGE_LOAD_TIMEOUT_MS,
  PAGE_RELOAD_TIMEOUT_MS,
  WAIT_FOR_DEFAULT_MS,
  WAIT_FOR_GRACE_MS,
} from '../../config/constants.js';
import type { PreviewService } from '../../preview/preview.service.js';
import type { Hub } from '../../realtime/hub.js';
import type { HostToolDef } from '../../providers/provider.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-app browser tools, executed by the bridge script inside the bot's preview iframe. */
export function browserTools(
  bot: Bot,
  previews: PreviewService,
  hub: Hub,
  signal: AbortSignal,
  /** Wraps page content as untrusted data and flags prompt injection. */
  guard: (text: string, source: string) => string = (t) => t,
): HostToolDef[] {
  const actor = { name: bot.name, color: bot.color };
  const pageSource = () => {
    const p = previews.state(bot.id);
    return p ? `web page ${p.target}${p.path}` : 'web page';
  };

  /** While the human has control, browser actions wait. */
  const yieldToHuman = async () => {
    if (!previews.state(bot.id)?.humanControl) return;
    const prev = hub.statuses[bot.id];
    hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: BotStatus.Waiting, activity: 'Paused — you have browser control' });
    await previews.waitForControl(bot.id, signal);
    hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: BotStatus.Working, activity: prev?.activity });
  };

  const rawSnapshot = async () => {
    try {
      return await previews.command(bot.id, { op: BridgeOp.Snapshot }, actor, BRIDGE_QUICK_SNAPSHOT_MS);
    } catch {
      // The action probably triggered a full page load; wait for the new page's bridge.
      await previews.waitReady(bot.id, PAGE_RELOAD_TIMEOUT_MS);
      return previews.command(bot.id, { op: BridgeOp.Snapshot }, actor);
    }
  };
  /** Page content is untrusted: wrapped, and checked for prompt injection. */
  const snapshot = async () => guard(await rawSnapshot(), pageSource());

  /** Run an action, then return the page as it looks afterwards. */
  const act = async (cmd: BridgeCmd, withSnapshot = true) => {
    await yieldToHuman();
    const msg = await previews.command(bot.id, cmd, actor);
    if (!withSnapshot) return msg;
    await sleep(ACTION_SETTLE_MS);
    return `${msg}\n\n${await snapshot()}`;
  };

  const ref = z.string().describe('Element ref from the latest snapshot, e.g. "e12"');

  return [
    {
      name: HostTool.BrowserOpen,
      description: 'Open a URL in your in-app browser (e.g. http://localhost:3000, or /path relative to the current page). Returns a snapshot of the page.',
      schema: { url: z.string() },
      handler: async ({ url }) => {
        await yieldToHuman();
        const loaded = previews.waitReady(bot.id, PAGE_LOAD_TIMEOUT_MS);
        await previews.open(bot.id, url);
        if (!(await loaded)) throw new Error('The page did not finish loading. Is the server running? Is the AgentRoom UI open?');
        return snapshot();
      },
    },
    {
      name: HostTool.BrowserSnapshot,
      description: 'Read the current page as an outline of text, headings and interactive elements with refs.',
      schema: {},
      handler: () => snapshot(),
    },
    {
      name: HostTool.BrowserClick,
      description: 'Click an element by ref. Returns the updated snapshot.',
      schema: { ref, element: z.string().optional().describe('Short description of the element, for the human') },
      handler: ({ ref }) => act({ op: BridgeOp.Click, ref }),
    },
    {
      name: HostTool.BrowserType,
      description: 'Set the text of an input, textarea, select or contenteditable by ref. Optionally press Enter to submit.',
      schema: { ref, text: z.string(), submit: z.boolean().optional(), element: z.string().optional() },
      handler: ({ ref, text, submit }) => act({ op: BridgeOp.Type, ref, text, submit }),
    },
    {
      name: HostTool.BrowserPress,
      description: 'Press a key (Enter, Escape, Tab, ArrowDown…) on the focused element.',
      schema: { key: z.string() },
      handler: ({ key }) => act({ op: BridgeOp.Press, key }),
    },
    {
      name: HostTool.BrowserWaitFor,
      description: 'Wait until some text appears on the page.',
      schema: { text: z.string(), timeoutMs: z.number().int().min(100).max(30000).optional() },
      handler: ({ text, timeoutMs = WAIT_FOR_DEFAULT_MS }) =>
        previews.command(bot.id, { op: BridgeOp.WaitFor, text, timeoutMs }, actor, timeoutMs + WAIT_FOR_GRACE_MS),
    },
    {
      name: HostTool.BrowserBack,
      description: 'Go back in history.',
      schema: {},
      handler: () => act({ op: BridgeOp.Back }),
    },
    {
      name: HostTool.BrowserConsole,
      description: 'Recent console messages, page errors and failed network requests from the page.',
      schema: {},
      handler: async () => {
        const lines = hub.recentConsole(bot.id);
        if (!lines.length) return 'Console is empty.';
        return guard(lines.map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${l.text}`).join('\n'), `console of ${pageSource()}`);
      },
    },
    {
      name: HostTool.BrowserEval,
      description: 'Run JavaScript in the page and return the result. Pass an expression, or a function body that uses `return`.',
      schema: { code: z.string() },
      handler: async ({ code }) => guard(await act({ op: BridgeOp.Eval, code }, false), `script result on ${pageSource()}`),
    },
  ];
}
