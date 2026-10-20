import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderId } from '../../shared/enums.js';
import type { ProviderGuarantees, ProviderStatus, Settings } from '../../shared/types/index.js';
import { EXPERIMENTAL_PROVIDERS } from './registry.js';
import { PROVIDER_NAMES } from './router.js';

/** What each provider guarantees about approvals and isolation (shown next to the provider). */
export function guaranteesFor(id: string, engine: Settings['engine']): ProviderGuarantees {
  switch (id) {
    case ProviderId.Codex:
      return {
        perCommandApproval: false,
        sandbox: engine.codex.sandbox === 'read-only' ? "Codex sandbox: read-only" : `Codex sandbox: writes only inside the goal's folder${engine.codex.network ? '' : ', no network'}`,
        hostTools: true,
        resume: true,
        exactCost: false,
        notes: [
          "Codex runs its own agent loop, so AgentRoom can't approve single commands; its sandbox confines them instead.",
          'AgentRoom tools (tasks, delegation, ask_human) are served to it over a local MCP endpoint that dies with the run.',
          'Spend is estimated from tokens with the prices you set (0 for a ChatGPT plan).',
        ],
      };
    case ProviderId.Gemini:
      return {
        perCommandApproval: false,
        sandbox: `Gemini approval mode "${engine.gemini.approvalMode}"${engine.gemini.sandbox ? ' in its sandbox' : ', no sandbox'}`,
        hostTools: true,
        resume: false,
        exactCost: false,
        notes: [
          'Headless Gemini refuses tools that need approval unless the approval mode allows them.',
          'Each run starts a fresh session; the chat history is not carried over.',
          'Spend is estimated from tokens with the prices you set.',
        ],
      };
    case ProviderId.OpenAICompat:
      return {
        perCommandApproval: true,
        sandbox: 'AgentRoom approval gate; file tools confined to the working folder',
        hostTools: true,
        resume: false,
        exactCost: false,
        notes: [
          'AgentRoom runs the tool loop itself, so every write and command goes through the same approvals as Claude.',
          'Tool use depends on the model: pick one trained for function calling (e.g. Qwen, Llama 3.1+).',
          'No web tools; each run starts fresh.',
        ],
      };
    default:
      return {
        perCommandApproval: true,
        sandbox: 'AgentRoom approval gate (permission mode, alwaysAsk rules, security gates)',
        hostTools: true,
        resume: true,
        exactCost: true,
        notes: ['The reference provider: every feature is built and tested on it.'],
      };
  }
}

const run = (cmd: string, args: string[], timeout = 5000) =>
  new Promise<string | null>((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : stdout.toString().trim().split('\n')[0] ?? ''));
  });

/** Path of an installed package's package.json, or null. */
function resolvePackage(name: string): string | null {
  try {
    const entry = fileURLToPath(import.meta.resolve(name));
    let dir = path.dirname(entry);
    for (let i = 0; i < 5; i++) {
      const pj = path.join(dir, 'package.json');
      if (fs.existsSync(pj)) {
        const json = JSON.parse(fs.readFileSync(pj, 'utf8')) as { name?: string };
        if (json.name === name) return pj;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // not installed
  }
  return null;
}

const home = (...p: string[]) => path.join(os.homedir(), ...p);

/** Is each provider installed, signed in and which models does it offer? Read-only checks, a few seconds at most. */
export async function providerStatuses(o: { engine: Settings['engine']; hasKey: (id: string) => boolean; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv }): Promise<ProviderStatus[]> {
  const env = o.env ?? process.env;
  const base = (id: string) => ({ id, name: PROVIDER_NAMES[id] ?? id, experimental: EXPERIMENTAL_PROVIDERS.has(id), guarantees: guaranteesFor(id, o.engine), hasKey: o.hasKey(id) });

  const claude = async (): Promise<ProviderStatus> => {
    const version = await run('claude', ['--version']);
    return { ...base(ProviderId.Claude), available: true, ...(version ? { version } : {}), auth: env.ANTHROPIC_API_KEY || fs.existsSync(home('.claude')) ? 'ok' : 'unknown', models: [] };
  };

  const codex = async (): Promise<ProviderStatus> => {
    const pj = resolvePackage('@openai/codex-sdk');
    const version = pj ? (JSON.parse(fs.readFileSync(pj, 'utf8')) as { version?: string }).version : undefined;
    const signedIn = fs.existsSync(home('.codex', 'auth.json')) || !!env.OPENAI_API_KEY || !!env.CODEX_API_KEY || o.hasKey(ProviderId.Codex);
    return {
      ...base(ProviderId.Codex),
      available: !!pj,
      ...(version ? { version } : {}),
      auth: signedIn ? 'ok' : 'missing',
      ...(!pj ? { hint: 'Install the Codex SDK next to AgentRoom: npm install -g @openai/codex-sdk' } : !signedIn ? { hint: 'Run `codex login`, or add an OpenAI API key below.' } : {}),
      models: [],
    };
  };

  const gemini = async (): Promise<ProviderStatus> => {
    const version = await run('gemini', ['--version'], 8000);
    const signedIn = fs.existsSync(home('.gemini', 'oauth_creds.json')) || !!env.GEMINI_API_KEY || !!env.GOOGLE_API_KEY || o.hasKey(ProviderId.Gemini);
    return {
      ...base(ProviderId.Gemini),
      available: version !== null,
      ...(version ? { version } : {}),
      auth: signedIn ? 'ok' : version ? 'unknown' : 'missing',
      ...(version === null ? { hint: 'Install the Gemini CLI: npm install -g @google/gemini-cli' } : !signedIn ? { hint: 'Run `gemini` once to sign in, or add a Gemini API key below.' } : {}),
      models: [],
    };
  };

  const compat = async (): Promise<ProviderStatus> => {
    const url = o.engine.openaiCompat.baseUrl.replace(/\/+$/, '');
    const fetchImpl = o.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(`${url}/models`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { id?: string }[] };
      const models = (json.data ?? []).map((m) => m.id).filter((m): m is string => !!m).slice(0, 50);
      return { ...base(ProviderId.OpenAICompat), available: true, auth: 'ok', models, ...(!o.engine.openaiCompat.model ? { hint: 'Pick a default model.' } : {}) };
    } catch (err) {
      return { ...base(ProviderId.OpenAICompat), available: false, auth: 'unknown', models: [], hint: `Nothing answering at ${url} (${(err as Error).message}). Start Ollama or LM Studio, or change the URL.` };
    }
  };

  return Promise.all([claude(), codex(), gemini(), compat()]);
}
