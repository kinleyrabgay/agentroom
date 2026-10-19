import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentKind, HostTool, TaskKind } from '../src/shared/enums.js';
import { detect } from '../src/server/services/upload-detect.js';
import { isUploadId, safeName, UploadStore, type ResolvedAttachment } from '../src/server/services/upload.store.js';
import { buildUserContent } from '../src/server/providers/claude/user-content.js';
import { requireToken } from '../src/server/http/auth.js';
import { uploadRoutes } from '../src/server/http/routes/uploads.routes.js';
import { Project } from '../src/core/project.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { GoalRunner } from '../src/server/workflow/goal-runner.js';

// --- tiny image/PDF fixtures (headers are all detection needs) ---
function png(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr]);
}
function jpeg(w: number, h: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
function gif(w: number, h: number): Buffer {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}
function webp(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ar-uploads-'));

describe('upload detection', () => {
  it('detects images by magic bytes with dimensions', () => {
    expect(detect(png(64, 32), 'application/octet-stream', 'x')).toMatchObject({ kind: AttachmentKind.Image, mime: 'image/png', width: 64, height: 32 });
    expect(detect(jpeg(800, 600), '', 'a.jpg')).toMatchObject({ kind: AttachmentKind.Image, mime: 'image/jpeg', width: 800, height: 600 });
    expect(detect(gif(10, 20), '', 'a.gif')).toMatchObject({ kind: AttachmentKind.Image, mime: 'image/gif', width: 10, height: 20 });
    expect(detect(webp(300, 200), '', 'a.webp')).toMatchObject({ kind: AttachmentKind.Image, mime: 'image/webp', width: 300, height: 200 });
  });

  it('detects PDFs, text and other files', () => {
    expect(detect(pdf(), 'application/octet-stream', 'spec.bin')).toMatchObject({ kind: AttachmentKind.Pdf, mime: 'application/pdf' });
    expect(detect(Buffer.from('# Notes\nhello'), '', 'notes.md').kind).toBe(AttachmentKind.Text);
    expect(detect(Buffer.from('{"a":1}'), 'application/json', 'data').kind).toBe(AttachmentKind.Text);
    expect(detect(Buffer.from([0, 1, 2, 3, 255]), 'application/zip', 'a.zip').kind).toBe(AttachmentKind.File);
    // Text that's too big to inline is kept as a file.
    expect(detect(Buffer.alloc(300 * 1024, 'a'), 'text/plain', 'big.log').kind).toBe(AttachmentKind.File);
    // A "text" extension with invalid UTF-8 is a file.
    expect(detect(Buffer.from([0xc3, 0x28]), 'text/plain', 'bad.txt').kind).toBe(AttachmentKind.File);
  });
});

describe('UploadStore', () => {
  it('saves, resolves and serves metadata', () => {
    const root = tmp();
    const store = new UploadStore(path.join(root, '.agentroom/runs/uploads'), root);
    const a = store.save({ name: 'shot.png', mime: 'image/png', bytes: png(64, 32) });
    expect(isUploadId(a.id)).toBe(true);
    expect(a).toMatchObject({ name: 'shot.png', kind: AttachmentKind.Image, width: 64, height: 32 });
    const r = store.get(a.id)!;
    expect(r.relPath).toBe(`.agentroom/runs/uploads/${a.id}/shot.png`);
    expect(fs.readFileSync(r.path).equals(png(64, 32))).toBe(true);
  });

  it('enforces size limits with a clear message for big images', () => {
    const store = new UploadStore(tmp(), tmp());
    const big = Buffer.concat([png(4000, 4000), Buffer.alloc(6 * 1024 * 1024)]);
    expect(() => store.save({ name: 'big.png', mime: 'image/png', bytes: big })).toThrow(/Image is 6\.0 MB; the model accepts up to 5\.0 MB — crop or compress it/);
    expect(() => store.save({ name: 'huge.bin', mime: '', bytes: Buffer.alloc(20 * 1024 * 1024 + 1) })).toThrow(/up to 20\.0 MB/);
    expect(() => store.save({ name: 'empty', mime: '', bytes: Buffer.alloc(0) })).toThrow(/empty/);
  });

  it('sanitizes names and rejects traversal / unknown ids', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('..\\..\\win.ini')).toBe('win.ini');
    expect(safeName('.hidden')).toBe('hidden');
    expect(safeName('a'.repeat(300) + '.png').length).toBeLessThanOrEqual(120);
    expect(safeName('a'.repeat(300) + '.png').endsWith('.png')).toBe(true);
    const store = new UploadStore(tmp(), tmp());
    expect(store.get('../../x')).toBeUndefined();
    expect(isUploadId('../abc')).toBe(false);
    expect(() => store.resolve(['A'.repeat(20)])).toThrow(/not found/);
    expect(() => store.resolve(Array.from({ length: 11 }, (_, i) => `id${i}`.padEnd(20, 'x')))).toThrow(/Up to 10/);
  });

  it('prunes uploads older than the retention period', () => {
    const dir = tmp();
    const store = new UploadStore(dir, tmp());
    const a = store.save({ name: 'n.txt', mime: 'text/plain', bytes: Buffer.from('hi') });
    expect(store.prune(30, Date.now())).toBe(0);
    expect(store.prune(30, Date.now() + 31 * 86_400_000)).toBe(1);
    expect(store.get(a.id)).toBeUndefined();
  });
});

describe('upload routes', () => {
  function makeApp() {
    const root = tmp();
    const store = new UploadStore(path.join(root, 'uploads'), root);
    const api = new Hono();
    api.use('*', requireToken('tok'));
    uploadRoutes(api, store);
    const root2 = new Hono();
    root2.route('/api', api);
    return { app: root2, store };
  }
  const form = (name: string, bytes: Buffer, type: string) => {
    const f = new FormData();
    f.set('file', new File([new Uint8Array(bytes)], name, { type }));
    return f;
  };

  it('uploads with the header token and serves the file with ?t= on GET only', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/uploads', { method: 'POST', body: form('shot.png', png(8, 4), 'image/png'), headers: { 'x-agentroom-token': 'tok' } });
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a).toMatchObject({ kind: 'image', width: 8, height: 4 });

    const img = await app.request(`/api/uploads/${a.id}?t=tok`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).equals(png(8, 4))).toBe(true);

    // The query token is accepted only for the file GET.
    expect((await app.request(`/api/uploads/${a.id}/meta?t=tok`)).status).toBe(401);
    expect((await app.request(`/api/uploads?t=tok`, { method: 'POST', body: form('x.txt', Buffer.from('x'), 'text/plain') })).status).toBe(401);
    expect((await app.request(`/api/uploads/${a.id}?t=wrong`)).status).toBe(401);
    expect((await app.request(`/api/uploads/${a.id}/meta`, { headers: { 'x-agentroom-token': 'tok' } })).status).toBe(200);
    // Encoded traversal never qualifies for the query token, and is not found with the header token.
    expect((await app.request(`/api/uploads/..%2F..%2Fsecrets?t=tok`)).status).toBe(401);
    expect((await app.request(`/api/uploads/..%2F..%2Fsecrets`, { headers: { 'x-agentroom-token': 'tok' } })).status).toBe(404);
  });

  it('rejects requests without a file', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/uploads', { method: 'POST', body: new FormData(), headers: { 'x-agentroom-token': 'tok' } });
    expect(res.status).toBe(400);
  });
});

describe('content blocks', () => {
  const att = (kind: AttachmentKind, name: string, mime: string): ResolvedAttachment => ({
    id: 'id_' + name,
    name,
    mime,
    size: 1,
    kind,
    path: `/abs/${name}`,
    relPath: `.agentroom/runs/uploads/x/${name}`,
  });
  const files: Record<string, Buffer> = { '/abs/a.png': png(1, 1), '/abs/b.pdf': pdf(), '/abs/c.md': Buffer.from('# hi'), '/abs/d.zip': Buffer.from('PK') };

  it('builds image, document and text blocks, and lists every saved path', () => {
    const blocks = buildUserContent(
      'What is this?',
      [att(AttachmentKind.Image, 'a.png', 'image/png'), att(AttachmentKind.Pdf, 'b.pdf', 'application/pdf'), att(AttachmentKind.Text, 'c.md', 'text/markdown'), att(AttachmentKind.File, 'd.zip', 'application/zip')],
      (p) => files[p],
    );
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'document', 'text']);
    const intro = blocks[0] as { text: string };
    expect(intro.text).toContain('What is this?');
    expect(intro.text).toContain('Attached: d.zip (file) — saved at .agentroom/runs/uploads/x/d.zip');
    expect(blocks[1]).toMatchObject({ source: { type: 'base64', media_type: 'image/png', data: png(1, 1).toString('base64') } });
    expect(blocks[2]).toMatchObject({ source: { media_type: 'application/pdf' }, title: 'b.pdf' });
    expect((blocks[3] as { text: string }).text).toBe('--- c.md ---\n# hi');
  });
});

// --- the provider sends a structured message only when there are attachments ---
const captured: { prompt: unknown }[] = [];
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown }) => {
    captured.push(args);
    return (async function* () {})();
  },
  createSdkMcpServer: () => ({}),
  tool: () => ({}),
}));

describe('ClaudeProvider prompt', () => {
  it('uses a plain string without attachments and a user message with them', async () => {
    const { ClaudeProvider } = await import('../src/server/providers/claude/claude.provider.js');
    const bot = { id: 'qa', name: 'QA', role: 'qa', tools: [], skills: [], localSkills: [], prompt: '' } as never;
    const base = {
      bot,
      cwd: tmp(),
      model: 'm',
      skills: { libraryPluginDir: tmp(), botPluginDir: tmp() },
      context: '',
      hostTools: [],
      signal: new AbortController().signal,
      emit: () => {},
      stream: () => {},
      askPermission: async () => ({ allow: true as const }),
    };
    const p = new ClaudeProvider();
    await p.run({ ...base, prompt: 'hello' });
    expect(captured.at(-1)!.prompt).toBe('hello');

    const root = tmp();
    const store = new UploadStore(path.join(root, 'u'), root);
    const a = store.save({ name: 'shot.png', mime: 'image/png', bytes: png(2, 2) });
    await p.run({ ...base, prompt: 'look', attachments: [store.get(a.id)!] });
    const prompt = captured.at(-1)!.prompt as AsyncIterable<{ type: string; message: { content: { type: string }[] } }>;
    expect(typeof prompt).not.toBe('string');
    const messages = [];
    for await (const m of prompt) messages.push(m);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('user');
    expect(messages[0].message.content.map((b) => b.type)).toEqual(['text', 'image']);
  });
});

// --- goal attachments reach the Planner ---
class RecordingProvider implements Provider {
  readonly id = 'rec';
  readonly requests: RunRequest[] = [];
  async run(req: RunRequest): Promise<RunResult> {
    this.requests.push(req);
    if (req.bot.role === 'planner') {
      const goalId = /goal (G-\d+)/.exec(req.prompt)![1];
      const create = req.hostTools.find((t) => t.name === HostTool.TaskCreate)!;
      await create.handler({ title: 'Do it', kind: TaskKind.Dev, goalId, assignee: 'developer' });
    }
    return { ok: true, result: 'ok' };
  }
  async listModels() {
    return [];
  }
}

describe('goal attachments', () => {
  it('validates ids, gives the Planner the files as content and lists their paths', async () => {
    const root = tmp();
    const project = new Project(root);
    project.init();
    project.config.update({ permissionMode: 'auto' });
    const hub = new Hub(project.paths.runs);
    const provider = new RecordingProvider();
    const notifications = new NotificationService(hub, project.paths.inboxFile);
    const uploads = new UploadStore(project.paths.uploads, project.root);
    const team = new Team({
      project,
      hub,
      provider,
      previews: new PreviewService(hub),
      permissions: new PermissionGate(hub, () => project.config.get(), root),
      sessions: new SessionStore(project.paths.sessionsFile),
      notifications,
      boardChanged: () => {},
      uploads,
    });
    const runner = new GoalRunner({ project, team, hub, notifications, boardChanged: () => {}, uploads });
    expect(() => runner.start('Fix it', undefined, [], undefined, ['A'.repeat(20)])).toThrow(/not found/);

    const a = uploads.save({ name: 'bug.png', mime: 'image/png', bytes: png(10, 10) });
    const goal = runner.start('Fix the layout bug in the screenshot', undefined, [], undefined, [a.id]);
    expect(project.goals.get(goal.id)!.attachments).toEqual([a.id]);

    const end = Date.now() + 3000;
    while (!provider.requests.some((r) => r.bot.role === 'planner')) {
      if (Date.now() > end) throw new Error('planner never ran');
      await new Promise((r) => setTimeout(r, 10));
    }
    const planner = provider.requests.find((r) => r.bot.role === 'planner')!;
    expect(planner.attachments?.map((x) => x.id)).toEqual([a.id]);
    expect(planner.prompt).toContain('## Files the human attached to this goal');
    expect(planner.prompt).toContain(`.agentroom/runs/uploads/${a.id}/bug.png`);
  });
});
