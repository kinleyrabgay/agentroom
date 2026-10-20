import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { APP_VERSION } from '../../shared/constants.js';
import { HOST_MCP_SERVER } from '../config/constants.js';
import { tokenMatches } from '../http/auth.js';
import type { HostToolDef } from './provider.js';

/** Path the bridge is served on (local only: the tunnel guard 404s it). */
export const HOST_BRIDGE_PATH = '/__agentroom/mcp';

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * AgentRoom's host tools (tasks, delegation, ask_human, context…) as a tiny MCP server over
 * streamable HTTP, so providers that run their own agent loop out of process (Codex, Gemini CLI)
 * can call them. Each run registers its tools under a random token that dies with the run.
 * Stateless JSON responses only: no SSE, no sessions, no resources.
 */
export class HostToolBridge {
  private runs = new Map<string, HostToolDef[]>();

  constructor(private readonly baseUrl: () => string | null) {}

  /** Expose a run's tools; returns the MCP URL and a disposer (call it when the run ends). */
  register(tools: HostToolDef[]): { url: string; name: string; dispose: () => void } | null {
    const base = this.baseUrl();
    if (!base || !tools.length) return null;
    const token = randomBytes(18).toString('base64url');
    this.runs.set(token, tools);
    return { url: `${base}${HOST_BRIDGE_PATH}/${token}`, name: HOST_MCP_SERVER, dispose: () => this.runs.delete(token) };
  }

  /** Active runs (for tests and status). */
  get size() {
    return this.runs.size;
  }

  private toolsFor(token: string): HostToolDef[] | undefined {
    for (const [t, tools] of this.runs) if (tokenMatches(t, token)) return tools;
    return undefined;
  }

  /** Handle one POST body. Returns null for notifications (HTTP 202, no body). */
  async handle(token: string, body: unknown): Promise<{ status: number; json: unknown } | null> {
    const tools = this.toolsFor(token);
    if (!tools) return { status: 404, json: rpcError(null, -32001, 'Unknown or finished run') };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((b) => this.one(tools, b as JsonRpcRequest)))).filter((r) => r !== null);
      return out.length ? { status: 200, json: out } : null;
    }
    const res = await this.one(tools, body as JsonRpcRequest);
    return res === null ? null : { status: 200, json: res };
  }

  private async one(tools: HostToolDef[], req: JsonRpcRequest): Promise<unknown | null> {
    if (!req || typeof req !== 'object' || typeof req.method !== 'string') return rpcError(null, -32600, 'Invalid request');
    const id = req.id ?? null;
    // Notifications (no id) get no response.
    if (req.id === undefined) return null;
    switch (req.method) {
      case 'initialize': {
        const asked = typeof req.params?.protocolVersion === 'string' ? (req.params.protocolVersion as string) : '';
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: HOST_MCP_SERVER, version: APP_VERSION },
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: tools.map(describeTool) });
      case 'tools/call': {
        const name = req.params?.name;
        const tool = tools.find((t) => t.name === name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
        const parsed = z.object(tool.schema).safeParse(req.params?.arguments ?? {});
        if (!parsed.success) return rpcResult(id, { content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }], isError: true });
        try {
          return rpcResult(id, { content: [{ type: 'text', text: await tool.handler(parsed.data) }] });
        } catch (err) {
          return rpcResult(id, { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true });
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${req.method}`);
    }
  }
}

/** MCP tool description with a JSON Schema for its arguments. */
export function describeTool(t: HostToolDef) {
  return { name: t.name, description: t.description, inputSchema: toolJsonSchema(t) };
}

/** JSON Schema of a host tool's arguments (also used for OpenAI-style function calling). */
export function toolJsonSchema(t: HostToolDef): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object(t.schema), { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
