import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { APP_VERSION } from '../../../shared/constants.js';
import { ProviderId } from '../../../shared/enums.js';
import type { AccountUsage, ModelOption } from '../../../shared/types/index.js';
import { HOST_MCP_SERVER } from '../../config/constants.js';
import type { HostToolDef, Provider, RunRequest, RunResult } from '../provider.js';
import { fetchClaudeAccountUsage } from './account-usage.js';
import { fetchClaudeModels } from './model-options.js';
import { buildSkillOptions } from './skill-options.js';
import { ClaudeStreamMapper } from './stream-mapper.js';

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

    const q = query({
      prompt: req.prompt,
      options: {
        cwd,
        model: req.model,
        ...(req.effort ? { effort: req.effort } : {}),
        abortController,
        resume: req.resumeSessionId,
        tools: skillOptions.tools,
        plugins: skillOptions.plugins,
        skills: skillOptions.skills,
        mcpServers: { [HOST_MCP_SERVER]: hostToolServer(req.hostTools) },
        // Isolate from user/project settings so AgentRoom's approval gate is authoritative.
        settingSources: [],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `${bot.prompt}\n\n${req.context}` },
        permissionMode: 'default',
        includePartialMessages: true,
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
