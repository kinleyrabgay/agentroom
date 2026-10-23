import { randomUUID } from 'node:crypto';
import { createSdkMcpServer, query, tool, type HookCallbackMatcher, type HookEvent, type McpServerConfig, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { APP_VERSION } from '../../../shared/constants.js';
import { AgentEventType, ProviderId, SteerStatus } from '../../../shared/enums.js';
import { TurnTracker, WRITE_TOOLS } from '../../agents/turn-changes.js';
import type { AccountUsage, ModelOption } from '../../../shared/types/index.js';
import { HOST_MCP_SERVER } from '../../config/constants.js';
import type { HostToolDef, Provider, RunRequest, RunResult } from '../provider.js';
import { fetchClaudeAccountUsage } from './account-usage.js';
import { fetchClaudeModels } from './model-options.js';
import { buildSkillOptions } from './skill-options.js';
import { InputChannel } from './input-channel.js';
import { ClaudeStreamMapper } from './stream-mapper.js';
import { buildUserContent, type UserContentBlock } from './user-content.js';

/** After a turn ends with a steer not yet taken, how long to wait for the CLI to pick it up before closing. */
const STEER_GRACE_MS = 4000;

/** Runs bots on the Claude Agent SDK (the user's Claude Code login or ANTHROPIC_API_KEY). */
export class ClaudeProvider implements Provider {
  readonly id = ProviderId.Claude;

  async run(req: RunRequest): Promise<RunResult> {
    const { bot, cwd } = req;
    const skillOptions = buildSkillOptions(bot, req.skills);
    const mapper = new ClaudeStreamMapper(bot.id, req.model, cwd, req.emit, req.stream, req.resumeSessionId);

    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    req.signal.addEventListener('abort', onAbort, { once: true });

    // The prompt is a stream so the human can steer the run: the first message starts it, later ones are folded in.
    const input = new InputChannel<SDKUserMessage>();
    input.push(userMessage(req.attachments?.length ? buildUserContent(req.prompt, req.attachments) : req.prompt));
    /** Steers written into the run and not yet taken, by message uuid → steer id. */
    const steers = new Map<string, string>();
    const delivered = new Set<string>();
    const take = (uuid: unknown) => {
      const id = typeof uuid === 'string' ? steers.get(uuid) : undefined;
      if (!id) return;
      steers.delete(uuid as string);
      delivered.add(id);
      req.steering?.status(id, SteerStatus.Delivered);
    };
    req.steering?.attach({
      steer: (id, text) => {
        const uuid = randomUUID();
        if (!input.push({ ...userMessage(text), uuid: uuid as SDKUserMessage['uuid'] })) return false;
        steers.set(uuid, id);
        return true;
      },
    });
    let grace: NodeJS.Timeout | undefined;
    const tracker = new TurnTracker(cwd);

    const q = query({
      prompt: input,
      options: {
        cwd,
        ...(req.additionalDirectories?.length ? { additionalDirectories: req.additionalDirectories } : {}),
        model: req.model,
        ...(req.effort ? { effort: req.effort } : {}),
        ...(req.maxBudgetUsd !== undefined ? { maxBudgetUsd: Math.max(0.01, req.maxBudgetUsd) } : {}),
        abortController,
        resume: req.resumeSessionId,
        tools: skillOptions.tools,
        plugins: skillOptions.plugins,
        skills: skillOptions.skills,
        // Only AgentRoom's host tools and the servers added in AgentRoom; never everything set up in Claude Code.
        mcpServers: { ...((req.mcpServers ?? {}) as Record<string, McpServerConfig>), [HOST_MCP_SERVER]: hostToolServer(req.hostTools) },
        strictMcpConfig: true,
        // Isolate from user/project settings so AgentRoom's approval gate is authoritative.
        settingSources: [],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `${bot.prompt}\n\n${req.context}` },
        permissionMode: 'default',
        includePartialMessages: true,
        hooks: runHooks(tracker, req.inspectToolOutput),
        canUseTool: async (toolName, input, { signal }) => {
          const answer = await req.askPermission(toolName, input, signal);
          return answer.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: answer.message };
        },
        stderr: (data) => {
          if (/error/i.test(data)) console.error(`[${bot.id}] ${data.trim()}`);
        },
      },
    });

    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        // A steer is taken when the CLI echoes it, or when a reply names it as the message it answers.
        if (msg.type === 'user' && 'isReplay' in msg && msg.isReplay) take(msg.uuid);
        else if (msg.type === 'assistant' && !msg.parent_tool_use_id) take((msg as { user_message_uuid?: string }).user_message_uuid);
        mapper.handle(msg);
        if (msg.type !== 'result') continue;
        clearTimeout(grace);
        // More turns follow only for steers the CLI still holds; otherwise end the run here.
        if ((msg.queued_turn_count ?? 0) > 0) continue;
        if (!steers.size) input.close();
        else grace = setTimeout(() => input.close(), STEER_GRACE_MS);
      }
    } finally {
      clearTimeout(grace);
      input.close();
      req.signal.removeEventListener('abort', onAbort);
      req.steering?.attach(null);
      // Steers the run never took go back to the queue.
      for (const id of steers.values()) if (!delivered.has(id)) req.steering?.status(id, SteerStatus.Failed);
      mapper.finish();
      const changes = await tracker.finish().catch(() => null);
      if (changes) req.emit({ type: AgentEventType.TurnChanges, botId: bot.id, ...changes });
    }
    return { ...mapper.result, sessionId: mapper.sessionId };
  }

  listModels(cwd: string): Promise<ModelOption[]> {
    return fetchClaudeModels(cwd);
  }

  fetchAccountUsage(cwd: string): Promise<AccountUsage | null> {
    return fetchClaudeAccountUsage(cwd);
  }
}

/** Tools whose output comes from outside the repo: the open web and external MCP servers (not AgentRoom's own). */
const WEB_TOOLS = `WebFetch|WebSearch|mcp__(?!${HOST_MCP_SERVER}__).*`;

/** A user message for the prompt stream. */
function userMessage(content: string | UserContentBlock[]): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage;
}

/** Hooks every run gets: write tracking for the run's changes, and the web-content guard when there is one. */
function runHooks(tracker: TurnTracker, inspect?: RunRequest['inspectToolOutput']): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const writes = Object.keys(WRITE_TOOLS).join('|');
  const track = (input: { hook_event_name: string; tool_name?: string; tool_input?: unknown; tool_use_id?: string }) => {
    if (!input.tool_use_id || !input.tool_name) return;
    if (input.hook_event_name === 'PreToolUse') tracker.before(input.tool_use_id, input.tool_name, input.tool_input);
    else tracker.after(input.tool_use_id);
  };
  const tracking: HookCallbackMatcher = {
    matcher: writes,
    hooks: [
      async (input) => {
        try {
          track(input as Parameters<typeof track>[0]);
        } catch {
          // Tracking is best-effort; never fail the tool over it.
        }
        return {};
      },
    ],
  };
  return {
    PreToolUse: [tracking],
    PostToolUse: [tracking, ...(inspect ? [webOutputHook(inspect)] : [])],
    PostToolUseFailure: [tracking],
  };
}

/** Flag prompt injection in web content the bot just read, as extra context next to the tool result. */
function webOutputHook(inspect: NonNullable<RunRequest['inspectToolOutput']>) {
  return {
    matcher: WEB_TOOLS,
    hooks: [
      async (input: { hook_event_name: string; tool_name?: string; tool_response?: unknown }) => {
        if (input.hook_event_name !== 'PostToolUse' || !input.tool_name) return {};
        const output = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response ?? '');
        const warning = inspect(input.tool_name, output);
        return warning ? { hookSpecificOutput: { hookEventName: 'PostToolUse' as const, additionalContext: warning } } : {};
      },
    ],
  };
}

/** Expose AgentRoom's host tools to Claude as an in-process MCP server. */
function hostToolServer(tools: HostToolDef[]) {
  return createSdkMcpServer({
    name: HOST_MCP_SERVER,
    version: APP_VERSION,
    tools: tools.map((t) =>
      tool(t.name, t.description, t.schema, async (args) => {
        try {
          return { content: [{ type: 'text', text: await t.handler(args) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
        }
      }),
    ),
  });
}
