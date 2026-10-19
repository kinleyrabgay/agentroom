import { HostTool, PermissionMode, ToolName } from '../../shared/enums.js';
import type { Config } from '../../shared/types/index.js';
import { HOST_TOOL_PREFIX } from '../config/constants.js';
import { MCP_TOOL_PREFIX } from '../../shared/constants.js';

/** Approval groups that "Always allow" applies to. */
export const ApprovalGroup = {
  Browser: 'Browser',
  /** Running JS is riskier than clicking, so "Always allow Browser" does not cover it. */
  BrowserJs: 'Browser JS',
} as const;

/**
 * `group` is the key "Always allow" applies to. `sticky` asks can never be session-allowed.
 * Allows say why: by the policy (with the rule) or by a session "Always allow" (rule = group).
 */
export type Decision =
  | { action: 'allow'; by: 'policy' | 'session'; rule: string }
  | { action: 'ask'; reason: string; sticky: boolean; group: string };

const READ_ONLY = new Set<string>([ToolName.Read, ToolName.Grep, ToolName.Glob, 'LS', ToolName.WebSearch, ToolName.WebFetch, ToolName.TodoWrite, ToolName.Skill, 'NotebookRead']);
const WRITES = new Set<string>([ToolName.Edit, ToolName.Write, ToolName.MultiEdit, ToolName.NotebookEdit]);
/** In-app browser tools that only look or move between pages; the rest act on the page. */
const BROWSER_READ = new Set<string>([HostTool.BrowserOpen, HostTool.BrowserSnapshot, HostTool.BrowserConsole, HostTool.BrowserWaitFor, HostTool.BrowserBack]);

/** First `alwaysAsk` pattern that starts any command segment (split on ; && || | newlines), or null. */
export function matchesAlwaysAsk(command: string, patterns: string[]): string | null {
  const segments = command.split(/;|&&|\|\||\||\n/).map((s) => s.trim().replace(/\s+/g, ' '));
  for (const seg of segments) {
    // Strip leading env assignments and common wrappers, e.g. `FOO=1 sudo git push`.
    const cmd = seg.replace(/^(\w+=\S*\s+)*/, '').replace(/^(sudo|command|exec|env)\s+/, '');
    for (const p of patterns) {
      if (cmd === p || cmd.startsWith(p + ' ')) return p;
    }
  }
  return null;
}

/** What the policy needs to know about external MCP tools (`mcp__<server>__<tool>`). */
export interface McpToolInfo {
  /** The server marks the tool read-only. */
  isReadOnlyTool(tool: string): boolean;
  serverOf(tool: string): string | undefined;
}

/**
 * Decide whether a tool call can run without asking the human.
 * `sessionAllowed` holds groups the human chose "Always allow" for during this server session.
 */
export function decide(tool: string, input: Record<string, unknown>, config: Config, sessionAllowed: ReadonlySet<string>, mcp?: McpToolInfo): Decision {
  const hostTool = tool.startsWith(HOST_TOOL_PREFIX) ? tool.slice(HOST_TOOL_PREFIX.length) : null;
  const browser = hostTool?.startsWith('browser_') ? hostTool : null;
  if (hostTool && !browser) return { action: 'allow', by: 'policy', rule: 'AgentRoom host tool' };

  if (tool === ToolName.Bash) {
    const hit = matchesAlwaysAsk(String(input.command ?? ''), config.alwaysAsk);
    if (hit) return { action: 'ask', reason: `"${hit}" always requires approval`, sticky: true, group: tool };
  }

  const mcpServer = !hostTool && tool.startsWith(MCP_TOOL_PREFIX) ? (mcp?.serverOf(tool) ?? tool.split('__')[1]) : null;
  // "Always allow" for an MCP server covers all of its tools.
  const group = browser ? (browser === HostTool.BrowserEval ? ApprovalGroup.BrowserJs : ApprovalGroup.Browser) : mcpServer ? `MCP ${mcpServer}` : tool;

  if (config.permissionMode === PermissionMode.Auto) return { action: 'allow', by: 'policy', rule: 'auto mode' };
  if (sessionAllowed.has(group)) return { action: 'allow', by: 'session', rule: group };
  if (config.permissionMode === PermissionMode.AskWrites && (READ_ONLY.has(tool) || (browser && BROWSER_READ.has(browser)))) {
    return { action: 'allow', by: 'policy', rule: browser ? 'ask-writes: page read' : 'ask-writes: read-only tool' };
  }
  if (config.permissionMode === PermissionMode.AskWrites && mcpServer && mcp?.isReadOnlyTool(tool)) {
    return { action: 'allow', by: 'policy', rule: `ask-writes: read-only ${mcpServer} tool` };
  }

  const reason = browser
    ? 'acts on a web page'
    : mcpServer
      ? `uses ${mcpServer} (external service)`
      : WRITES.has(tool)
        ? 'modifies files'
        : tool === ToolName.Bash
          ? 'runs a shell command'
          : 'needs approval';
  return { action: 'ask', reason, sticky: false, group };
}
