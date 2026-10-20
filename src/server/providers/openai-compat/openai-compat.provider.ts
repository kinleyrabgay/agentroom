import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BotStatus, ProviderId, ToolName } from '../../../shared/enums.js';
import type { ModelOption } from '../../../shared/types/index.js';
import { toolJsonSchema } from '../host-bridge.js';
import { ProviderUnavailableError, type HostToolDef, type Provider, type ProviderDeps, type RunRequest, type RunResult } from '../provider.js';
import { classifyFailure, hostToolName, RunEvents, systemText, truncate, type RunUsage } from '../shared/run-events.js';

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** A tool the loop can run: its OpenAI function definition, how it maps to an approval, and what it does. */
interface LoopTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Name + input the permission gate sees (Claude Code tool names, so modes and rules apply unchanged). */
  gate: (args: Record<string, unknown>) => { tool: string; input: Record<string, unknown> };
  run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
}

const OUTPUT_LIMIT = 20_000;

/**
 * Any OpenAI-compatible chat endpoint (Ollama, LM Studio, vLLM, OpenRouter…), driven by AgentRoom's
 * own tool loop. Experimental. Because AgentRoom runs every tool itself, every file write and shell
 * command goes through the same approval gate as Claude, and file tools are confined to the run's folder.
 */
export class OpenAICompatProvider implements Provider {
  readonly id = ProviderId.OpenAICompat;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(req: RunRequest): Promise<RunResult> {
    const cfg = this.deps.engine().openaiCompat;
    const model = req.model && !/^claude|^(opus|sonnet|haiku|fable)\b/i.test(req.model) ? req.model : cfg.model;
    if (!model) throw new ProviderUnavailableError('No model set for the OpenAI-compatible provider. Pick one in Settings → Providers.', 'not-installed');
    const events = new RunEvents(req, this.id, model);
    const tools = [...builtinTools(req), ...req.hostTools.map(hostLoopTool)];
    const byName = new Map(tools.map((t) => [t.name, t]));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemText(req) },
      { role: 'user', content: req.prompt },
    ];
    const usage: RunUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const prices = { inPerMtok: cfg.priceInPerMtok, outPerMtok: cfg.priceOutPerMtok };
    const key = this.deps.secret(this.id);
    let final = '';

    events.status(BotStatus.Thinking);
    for (let turn = 0; turn < cfg.maxTurns; turn++) {
      if (req.signal.aborted) throw new Error('Stopped by human.');
      events.turn();
      let res: ChatResponse;
      try {
        res = await this.chat(cfg.baseUrl, key, { model, messages, tools: tools.map(fnDef), tool_choice: 'auto' }, req.signal);
      } catch (err) {
        const message = (err as Error).message;
        const kind = classifyFailure(message);
        if (kind && events.toolCalls === 0) throw new ProviderUnavailableError(`OpenAI-compatible endpoint: ${message}`, kind);
        return events.finish(false, `Run failed: ${message}`, usage, prices);
      }
      usage.input += res.usage?.prompt_tokens ?? 0;
      usage.output += res.usage?.completion_tokens ?? 0;
      usage.cacheRead += res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const msg = res.choices?.[0]?.message ?? {};
      const calls = msg.tool_calls ?? [];
      if (msg.content?.trim()) {
        final = msg.content;
        events.message(msg.content);
      }
      messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
      if (!calls.length) return events.finish(true, final || undefined, usage, prices);

      for (const call of calls) {
        const tool = byName.get(call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: arguments were not valid JSON.' });
          continue;
        }
        if (!tool) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: `Error: unknown tool ${call.function.name}.` });
          continue;
        }
        const gate = tool.gate(args);
        events.toolCall(call.id, gate.tool, gate.input);
        const answer = await req.askPermission(gate.tool, gate.input, req.signal);
        let output: string;
        let ok = true;
        if (!answer.allow) {
          ok = false;
          output = `Denied: ${answer.message}`;
        } else {
          try {
            output = await tool.run(args, req.signal);
          } catch (err) {
            ok = false;
            output = `Error: ${(err as Error).message}`;
          }
        }
        events.toolResult(call.id, ok, output);
        messages.push({ role: 'tool', tool_call_id: call.id, content: truncate(output, OUTPUT_LIMIT) });
      }
    }
    return events.finish(false, `Stopped after ${cfg.maxTurns} turns without finishing. Raise the limit in Settings → Providers.`, usage, prices);
  }

  private async chat(baseUrl: string, key: string | undefined, body: unknown, signal: AbortSignal): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }
    return (await res.json()) as ChatResponse;
  }

  async listModels(): Promise<ModelOption[]> {
    return [];
  }
}

const fnDef = (t: LoopTool) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } });

function hostLoopTool(t: HostToolDef): LoopTool {
  return {
    name: t.name,
    description: t.description,
    parameters: toolJsonSchema(t),
    gate: (args) => ({ tool: hostToolName(t.name), input: args }),
    run: (args) => t.handler(args),
  };
}

/** A path inside the run's folder, or an error. */
export function insideCwd(cwd: string, p: unknown): string {
  if (typeof p !== 'string' || !p) throw new Error('path is required');
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${p} is outside the working folder`);
  return abs;
}

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });

/** File and shell tools, limited to the bot's own tool list (bot.md `tools:`). */
export function builtinTools(req: Pick<RunRequest, 'bot' | 'cwd'>): LoopTool[] {
  const { cwd } = req;
  const allowed = new Set(req.bot.tools);
  const tools: LoopTool[] = [];
  if (allowed.has(ToolName.Read)) {
    tools.push({
      name: 'read_file',
      description: 'Read a text file (relative to the working folder). Optional 1-based line offset and line limit.',
      parameters: obj({ path: str('File path'), offset: { type: 'integer' }, limit: { type: 'integer' } }, ['path']),
      gate: (a) => ({ tool: ToolName.Read, input: { file_path: insideCwd(cwd, a.path) } }),
      run: async (a) => {
        const lines = fs.readFileSync(insideCwd(cwd, a.path), 'utf8').split('\n');
        const start = Math.max(0, Number(a.offset ?? 1) - 1);
        const end = a.limit ? start + Number(a.limit) : lines.length;
        return lines
          .slice(start, end)
          .map((l, i) => `${start + i + 1}\t${l}`)
          .join('\n');
      },
    });
  }
  if (allowed.has(ToolName.Glob)) {
    tools.push({
      name: 'list_files',
      description: 'List files under a folder (default: the working folder), optionally only paths containing a substring.',
      parameters: obj({ path: str('Folder'), contains: str('Only paths containing this text') }, []),
      gate: (a) => ({ tool: ToolName.Glob, input: { pattern: String(a.contains ?? '*'), path: insideCwd(cwd, a.path ?? '.') } }),
      run: async (a) => listFiles(insideCwd(cwd, a.path ?? '.'), cwd, typeof a.contains === 'string' ? a.contains : ''),
    });
  }
  if (allowed.has(ToolName.Grep)) {
    tools.push({
      name: 'search',
      description: 'Search file contents for a regular expression; returns path:line: text.',
      parameters: obj({ pattern: str('Regular expression'), path: str('Folder or file (default: working folder)') }, ['pattern']),
      gate: (a) => ({ tool: ToolName.Grep, input: { pattern: String(a.pattern), path: insideCwd(cwd, a.path ?? '.') } }),
      run: (a, signal) => exec('grep', ['-rnIE', '--exclude-dir=node_modules', '--exclude-dir=.git', '--', String(a.pattern), insideCwd(cwd, a.path ?? '.')], cwd, signal, 30_000),
    });
  }
  if (allowed.has(ToolName.Write)) {
    tools.push({
      name: 'write_file',
      description: 'Create or overwrite a file with the given content.',
      parameters: obj({ path: str('File path'), content: str('Full file content') }, ['path', 'content']),
      gate: (a) => ({ tool: ToolName.Write, input: { file_path: insideCwd(cwd, a.path), content: String(a.content ?? '') } }),
      run: async (a) => {
        const abs = insideCwd(cwd, a.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(a.content ?? ''));
        return `Wrote ${path.relative(cwd, abs)}`;
      },
    });
  }
  if (allowed.has(ToolName.Edit)) {
    tools.push({
      name: 'edit_file',
      description: 'Replace one exact occurrence of old_text with new_text in a file.',
      parameters: obj({ path: str('File path'), old_text: str('Exact text to replace (must occur once)'), new_text: str('Replacement') }, ['path', 'old_text', 'new_text']),
      gate: (a) => ({ tool: ToolName.Edit, input: { file_path: insideCwd(cwd, a.path), old_string: String(a.old_text ?? ''), new_string: String(a.new_text ?? '') } }),
      run: async (a) => {
        const abs = insideCwd(cwd, a.path);
        const text = fs.readFileSync(abs, 'utf8');
        const old = String(a.old_text ?? '');
        const at = text.indexOf(old);
        if (!old || at < 0) throw new Error('old_text not found');
        if (text.indexOf(old, at + 1) >= 0) throw new Error('old_text occurs more than once; include more context');
        fs.writeFileSync(abs, text.slice(0, at) + String(a.new_text ?? '') + text.slice(at + old.length));
        return `Edited ${path.relative(cwd, abs)}`;
      },
    });
  }
  if (allowed.has(ToolName.Bash)) {
    tools.push({
      name: 'run_command',
      description: 'Run a shell command in the working folder (bash). Output is truncated.',
      parameters: obj({ command: str('Command line'), timeout_sec: { type: 'integer', description: 'Default 120' } }, ['command']),
      gate: (a) => ({ tool: ToolName.Bash, input: { command: String(a.command ?? '') } }),
      run: (a, signal) => exec('bash', ['-lc', String(a.command ?? '')], cwd, signal, Math.min(600, Number(a.timeout_sec ?? 120)) * 1000),
    });
  }
  return tools;
}

function listFiles(dir: string, cwd: string, contains: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= 500) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(cwd, p);
        if (!contains || rel.includes(contains)) out.push(rel);
      }
      if (out.length >= 500) return;
    }
  };
  walk(dir);
  return out.length ? out.join('\n') + (out.length >= 500 ? '\n… (first 500)' : '') : '(no files)';
}

function exec(cmd: string, args: string[], cwd: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, signal, timeout: timeoutMs });
    let out = '';
    const take = (d: Buffer) => {
      if (out.length < OUTPUT_LIMIT * 2) out += d.toString();
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => resolve(`Error: ${err.message}`));
    child.on('close', (code) => resolve(`${truncate(out, OUTPUT_LIMIT)}${code ? `\n(exit code ${code})` : ''}` || '(no output)'));
  });
}
