import { createSdkMcpServer, query, tool, type McpServerConfig, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { APP_VERSION } from '../../../shared/constants.js';
import { ProviderId } from '../../../shared/enums.js';
import type { AccountUsage, ModelOption } from '../../../shared/types/index.js';
import { HOST_MCP_SERVER } from '../../config/constants.js';
import type { HostToolDef, Provider, RunRequest, RunResult } from '../provider.js';
import { fetchClaudeAccountUsage } from './account-usage.js';
import { fetchClaudeModels } from './model-options.js';
import { buildSkillOptions } from './skill-options.js';
import { ClaudeStreamMapper } from './stream-mapper.js';
import { buildUserContent, singleUserMessage } from './user-content.js';

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

    // Plain text goes as a string; attachments need a structured user message (image/document blocks).
    const prompt = req.attachments?.length
      ? (singleUserMessage(buildUserContent(req.prompt, req.attachments)) as unknown as AsyncIterable<SDKUserMessage>)
      : req.prompt;

    const q = query({
      prompt,
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
        ...(req.inspectToolOutput ? { hooks: { PostToolUse: [webOutputHook(req.inspectToolOutput)] } } : {}),
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
      for await (const msg of q as AsyncIterable<SDKMessage>) mapper.handle(msg);
    } finally {
      req.signal.removeEventListener('abort', onAbort);
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
