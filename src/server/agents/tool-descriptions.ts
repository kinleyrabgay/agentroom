import path from 'node:path';
import { HostTool, ToolName } from '../../shared/enums.js';
import { HOST_TOOL_PREFIX } from '../config/constants.js';

export interface ToolDescription {
  /** One-liner for the timeline. */
  summary: string;
  /** Present tense, for the bot card ("Editing src/app.ts"). */
  activity: string;
}

/** Strip the host MCP prefix so tools show as `browser_click`, not `mcp__agentroom__browser_click`. */
export function shortToolName(name: string): string {
  return name.startsWith(HOST_TOOL_PREFIX) ? name.slice(HOST_TOOL_PREFIX.length) : name;
}

const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function describeTool(rawName: string, input: Record<string, unknown>, cwd: string): ToolDescription {
  const name = shortToolName(rawName);
  const rel = (p: unknown) => (typeof p === 'string' ? (path.isAbsolute(p) ? path.relative(cwd, p) || '.' : p) : '');
  const str = (v: unknown) => String(v ?? '');

  switch (name) {
    case ToolName.Read: return { summary: rel(input.file_path), activity: `Reading ${rel(input.file_path)}` };
    case ToolName.Edit:
    case ToolName.MultiEdit: return { summary: rel(input.file_path), activity: `Editing ${rel(input.file_path)}` };
    case ToolName.Write: return { summary: rel(input.file_path), activity: `Writing ${rel(input.file_path)}` };
    case ToolName.Bash: {
      const cmd = clip(str(input.command).replace(/\s+/g, ' '));
      return { summary: cmd, activity: `Running ${cmd}` };
    }
    case ToolName.Grep: return { summary: `/${str(input.pattern)}/ ${rel(input.path)}`.trim(), activity: `Searching for ${clip(str(input.pattern), 40)}` };
    case ToolName.Glob: return { summary: str(input.pattern), activity: `Finding ${str(input.pattern)}` };
    case ToolName.WebSearch: return { summary: str(input.query), activity: `Searching web: ${clip(str(input.query), 40)}` };
    case ToolName.WebFetch: return { summary: str(input.url), activity: `Fetching ${clip(str(input.url), 50)}` };
    case ToolName.Skill: return { summary: str(input.skill ?? input.name), activity: `Using skill ${str(input.skill ?? input.name)}` };
    case HostTool.Delegate: return { summary: `→ ${str(input.bot)}: ${clip(str(input.instruction), 60)}`, activity: `Waiting on ${str(input.bot)}` };
    case HostTool.TaskCreate: return { summary: str(input.title), activity: 'Planning tasks' };
    case HostTool.TaskUpdate: {
      const what = input.status ? `→ ${str(input.status)}` : input.appendLog ? `log: ${clip(str(input.appendLog), 50)}` : input.acceptanceDone ? 'tick acceptance' : '';
      return { summary: `${str(input.id)} ${what}`.trim(), activity: `Updating ${str(input.id)}` };
    }
    case HostTool.TaskList: return { summary: input.goalId ? `goal ${str(input.goalId)}` : 'tasks', activity: 'Checking task board' };
    case HostTool.TaskGet: return { summary: str(input.id), activity: `Reading ${str(input.id)}` };
    case HostTool.TaskDelete: return { summary: str(input.id), activity: `Removing ${str(input.id)}` };
    case HostTool.PlanOverview: return { summary: `plan for ${str(input.goalId)}`, activity: 'Writing the plan' };
    case HostTool.NotifyHuman: return { summary: str(input.title), activity: 'Notifying you' };
    case HostTool.AskHuman: return { summary: clip(str(input.question)), activity: 'Waiting for your answer' };
    case HostTool.BrowserOpen: return { summary: str(input.url), activity: `Browsing ${clip(str(input.url), 50)}` };
    case HostTool.BrowserSnapshot: return { summary: 'read page', activity: 'Reading the page' };
    case HostTool.BrowserClick: return { summary: `${str(input.ref)}${input.element ? ` ${str(input.element)}` : ''}`, activity: `Clicking ${clip(str(input.element ?? input.ref), 40)}` };
    case HostTool.BrowserType: return { summary: `${str(input.ref)} ← "${clip(str(input.text), 40)}"`, activity: `Typing into ${clip(str(input.element ?? input.ref), 40)}` };
    case HostTool.BrowserPress: return { summary: str(input.key), activity: `Pressing ${str(input.key)}` };
    case HostTool.BrowserConsole: return { summary: 'console + network', activity: 'Checking the console' };
    case HostTool.BrowserWaitFor: return { summary: `"${clip(str(input.text), 40)}"`, activity: `Waiting for "${clip(str(input.text), 30)}"` };
    case HostTool.BrowserBack: return { summary: 'back', activity: 'Going back' };
    case HostTool.BrowserEval: return { summary: clip(str(input.code)), activity: 'Running JS in the page' };
    default: return { summary: clip(JSON.stringify(input ?? {})), activity: `Using ${name}` };
  }
}
