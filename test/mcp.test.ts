import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { McpRepository } from '../src/core/repositories/mcp.repository.js';
import { classifyToolCall } from '../src/server/agents/audit-classify.js';
import { decide } from '../src/server/safety/permission-policy.js';
import { resolveConfig, safeName, secretRefs, toolPrefix } from '../src/server/services/mcp/resolve.js';
import { McpScope } from '../src/shared/enums.js';
import { ConfigSchema } from '../src/shared/schemas.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-mcp-'));

describe('MCP config resolution', () => {
  const stdio = { type: 'stdio' as const, command: 'npx', args: ['-y', 'srv', '--host=${env:HOST}'], env: { TOKEN: '${secret:SENTRY_ACCESS_TOKEN}' } };

  it('lists secret references', () => {
    expect(secretRefs(stdio)).toEqual(['SENTRY_ACCESS_TOKEN']);
  });

  it('fills in secrets and env vars', () => {
    const r = resolveConfig(stdio, (n) => (n === 'SENTRY_ACCESS_TOKEN' ? 'tok' : undefined), { HOST: 'sentry.example.com' });
    expect(r.missing).toEqual([]);
    expect(r.config).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'srv', '--host=sentry.example.com'], env: { TOKEN: 'tok' } });
  });

  it('reports what is missing instead of starting with blanks', () => {
    const r = resolveConfig(stdio, () => undefined, {});
    expect(r.config).toBeNull();
    expect(r.missing.sort()).toEqual(['SENTRY_ACCESS_TOKEN', 'env:HOST']);
  });

  it('names tools like the SDK and makes import names safe', () => {
    expect(toolPrefix('sentry')).toBe('mcp__sentry__');
    expect(safeName('claude.ai Linear')).toBe('linear');
    expect(safeName('plugin:neon:neon')).toBe('neon');
  });
});

describe('McpRepository', () => {
  it('round-trips team and personal servers in .mcp.json shape, personal winning on name clash', () => {
    const dir = tmp();
    const files = { [McpScope.Team]: path.join(dir, 'mcp.json'), [McpScope.Personal]: path.join(dir, 'runs', 'mcp.local.json') };
    const repo = new McpRepository(files);
    repo.save({ name: 'sentry', config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' }, bots: ['*'], enabled: true }, McpScope.Team);
    repo.save({ name: 'linear', config: { type: 'http', url: 'https://mcp.linear.app/mcp' }, bots: ['developer'], enabled: false }, McpScope.Personal);

    const onDisk = JSON.parse(fs.readFileSync(files[McpScope.Team], 'utf8'));
    expect(onDisk.servers.sentry).toMatchObject({ type: 'http', url: 'https://mcp.sentry.dev/mcp', bots: ['*'], enabled: true });
    expect(repo.list().map((e) => [e.name, e.scope, e.enabled])).toEqual([
      ['linear', McpScope.Personal, false],
      ['sentry', McpScope.Team, true],
    ]);

    // Moving to the other scope removes it from the first file.
    repo.update('linear', { enabled: true });
    const { scope: _s, ...linear } = repo.get('linear')!;
    repo.save(linear, McpScope.Team);
    expect(JSON.parse(fs.readFileSync(files[McpScope.Personal], 'utf8')).servers).toEqual({});
    expect(repo.get('linear')?.scope).toBe(McpScope.Team);

    repo.remove('sentry');
    expect(repo.get('sentry')).toBeUndefined();
  });

  it('ignores an invalid file instead of crashing', () => {
    const dir = tmp();
    const team = path.join(dir, 'mcp.json');
    fs.writeFileSync(team, JSON.stringify({ servers: { 'bad name!': { url: 'x' } } }));
    expect(new McpRepository({ [McpScope.Team]: team, [McpScope.Personal]: path.join(dir, 'l.json') }).list()).toEqual([]);
  });
});

describe('MCP tools and the approval policy', () => {
  const cfg = ConfigSchema.parse({});
  const info = { isReadOnlyTool: (t: string) => t === 'mcp__sentry__find_issues', serverOf: () => 'sentry' };

  it('runs read-only tools without asking under ask-writes', () => {
    expect(decide('mcp__sentry__find_issues', {}, cfg, new Set(), info)).toMatchObject({ action: 'allow' });
  });

  it('asks before tools that change something, grouped per server', () => {
    const d = decide('mcp__sentry__update_issue', {}, cfg, new Set(), info);
    expect(d).toMatchObject({ action: 'ask', group: 'MCP sentry' });
    expect(decide('mcp__sentry__update_issue', {}, cfg, new Set(['MCP sentry']), info)).toMatchObject({ action: 'allow', by: 'session' });
  });

  it('still lets AgentRoom host tools through and audits external calls', () => {
    expect(decide('mcp__agentroom__task_list', {}, cfg, new Set(), info).action).toBe('allow');
    expect(classifyToolCall('mcp__sentry__update_issue', { issueId: 'X-1' })?.kind).toBe('mcp');
    expect(classifyToolCall('mcp__agentroom__task_list', {})).toBeNull();
  });
});
