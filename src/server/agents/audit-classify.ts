import { AuditKind, HostTool, ToolName } from '../../shared/enums.js';
import { HOST_TOOL_PREFIX } from '../config/constants.js';
import { MCP_TOOL_PREFIX } from '../../shared/constants.js';

const FILE_WRITES = new Set<string>([ToolName.Edit, ToolName.Write, ToolName.MultiEdit, ToolName.NotebookEdit]);
const BROWSER_ACTIONS = new Set<string>([HostTool.BrowserClick, HostTool.BrowserType, HostTool.BrowserPress, HostTool.BrowserEval]);

/** True when any command segment runs `git push`. */
export const isPush = (cmd: string) => /(^|[;&|]\s*|\s)git\s+(\S+\s+)*push(\s|$)/.test(cmd);
/** True when any command segment runs `gh pr create`. */
export const isPrCreate = (cmd: string) => /(^|[;&|]\s*|\s)gh\s+pr\s+create(\s|$)/.test(cmd);

/**
 * Which tool calls belong in the audit log, and how to summarize them. Reads and
 * bookkeeping tools (task_*) are deliberately left out to keep the log useful.
 */
export function classifyToolCall(tool: string, input: Record<string, unknown>): { kind: AuditKind; summary: string } | null {
  if (tool === ToolName.Bash) {
    const command = String(input.command ?? '').trim();
    const kind = isPrCreate(command) ? AuditKind.PullRequest : isPush(command) ? AuditKind.Push : AuditKind.Command;
    return { kind, summary: command };
  }
  if (FILE_WRITES.has(tool)) {
    const file = String(input.file_path ?? input.notebook_path ?? input.path ?? '');
    return { kind: AuditKind.FileWrite, summary: `${tool} ${file}`.trim() };
  }
  const host = tool.startsWith(HOST_TOOL_PREFIX) ? tool.slice(HOST_TOOL_PREFIX.length) : null;
  if (host && BROWSER_ACTIONS.has(host)) {
    const what = host === HostTool.BrowserEval ? String(input.code ?? '') : [input.element ?? input.ref, input.text ? `"${input.text}"` : '', input.key ?? ''].filter(Boolean).join(' ');
    return { kind: AuditKind.Command, summary: `${host} ${what}`.trim().slice(0, 300) };
  }
  if (!host && tool.startsWith(MCP_TOOL_PREFIX)) {
    const [, server, name] = tool.split('__');
    return { kind: AuditKind.Mcp, summary: `${server} · ${name} ${JSON.stringify(input ?? {})}`.slice(0, 300) };
  }
  return null;
}
