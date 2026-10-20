import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../src/shared/schemas.js';
import type { ProofReport, RiskAssessment } from '../src/shared/types/index.js';
import { a11yCheck, bundleBytes, bundleCheck, coverageCheck, perfCheck, readCoverage, summarize, visualCheck, withQuality, type A11yIssue } from '../src/server/proof/checks.js';
import { detectApp, portArgs } from '../src/server/proof/devserver.js';
import { decodePng, diffPercent, encodeGif, fit, type Bitmap } from '../src/server/proof/image.js';
import { PROOF_MARK, ProofService } from '../src/server/proof/proof.service.js';
import { PROOF_BRANCH, publishProof, rawUrl } from '../src/server/proof/publish.js';
import { cleanScenario, isAppPath, parseScenarios, stepLabel } from '../src/server/proof/scenario.js';
import { buildPrBody } from '../src/server/workflow/pr-body.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const quality = SettingsSchema.parse({}).quality;

/** Minimal PNG encoder for fixtures (RGBA, filter 0). */
function png(img: Bitmap): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: Buffer[] = [];
  for (let y = 0; y < img.height; y++) rows.push(Buffer.from([0]), Buffer.from(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const solid = (w: number, h: number, rgb: [number, number, number]): Bitmap => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width: w, height: h, data };
};

/** Decode the first frame of a GIF made by encodeGif (global palette, one image) to palette indices. */
function gifFirstFrame(buf: Buffer): { width: number; height: number; frames: number; indices: number[] } {
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  let off = 13 + 256 * 3;
  let frames = 0;
  let indices: number[] = [];
  while (off < buf.length && buf[off] !== 0x3b) {
    if (buf[off] === 0x21) {
      off += 2;
      while (buf[off] !== 0) off += buf[off] + 1;
      off++;
    } else if (buf[off] === 0x2c) {
      frames++;
      off += 10;
      const min = buf[off++];
      const data: number[] = [];
      while (buf[off] !== 0) {
        data.push(...buf.subarray(off + 1, off + 1 + buf[off]));
        off += buf[off] + 1;
      }
      off++;
      if (frames === 1) indices = lzwDecode(data, min, width * height);
    } else throw new Error(`bad block ${buf[off]}`);
  }
  return { width, height, frames, indices };
}

function lzwDecode(data: number[], min: number, count: number): number[] {
  const clear = 1 << min;
  const eoi = clear + 1;
  let size = min + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear }, (_, i) => [i]);
    dict.push([], []);
    size = min + 1;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  let prev: number[] | null = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    return v;
  };
  while (out.length < count) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad code');
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

describe('proof images', () => {
  it('decodes PNGs, encodes a valid looping GIF and measures visual change', () => {
    const red = solid(40, 20, [255, 0, 0]);
    const decoded = decodePng(png(red));
    expect(decoded.width).toBe(40);
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);

    // A gradient exercises many LZW codes (incl. code-size growth).
    const grad: Bitmap = { width: 64, height: 48, data: new Uint8Array(64 * 48 * 4) };
    for (let i = 0; i < 64 * 48; i++) grad.data.set([(i * 7) % 256, (i * 13) % 256, (i * 3) % 256, 255], i * 4);
    const gif = encodeGif([grad, red], { maxWidth: 64 });
    expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(gif.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
    const f = gifFirstFrame(gif);
    expect([f.width, f.height, f.frames]).toEqual([64, 48, 2]);
    expect(f.indices).toHaveLength(64 * 48);

    expect(fit(solid(2000, 1000, [0, 0, 0]), 960).width).toBe(960);
    expect(diffPercent(red, red)).toBe(0);
    expect(diffPercent(red, solid(40, 20, [0, 0, 255]))).toBe(100);
  });
});

describe('proof scenarios', () => {
  it('parses the last json block and drops unsafe or invalid steps', () => {
    const text = 'Here:\n```json\n{"scenarios":[{"name":"Export","path":"/reports","steps":[{"action":"click","target":"text=Export"},{"action":"goto","target":"https://evil.example"},{"action":"fly"},{"action":"fill","target":"#q"},{"action":"expect","value":"Ready"}]}]}\n```';
    const [s] = parseScenarios(text);
    expect(s.name).toBe('Export');
    expect(s.steps.map((x) => x.action)).toEqual(['click', 'expect']);
    expect(parseScenarios('no json here')).toEqual([]);
    expect(cleanScenario({ name: 'x', path: 'https://evil.example/' })).toBeNull();
    expect(isAppPath('http://localhost:3000/a')).toBe(true);
    expect(isAppPath('//evil.example')).toBe(false);
    expect(stepLabel({ action: 'click', target: 'text=Save' })).toBe('Click Save');
  });
});

describe('quality checks', () => {
  const issue = (rule: string, impact: A11yIssue['impact'] = 'serious'): A11yIssue => ({ rule, impact, target: 'button', help: rule });

  it('fails accessibility only on new serious issues compared with the base', () => {
    expect(a11yCheck([issue('a'), issue('b')], [issue('a')], quality).status).toBe('fail');
    expect(a11yCheck([issue('a'), issue('c', 'minor')], [issue('a')], quality).status).toBe('pass');
    expect(a11yCheck([issue('a')], null, quality).status).toBe('warn');
    expect(a11yCheck([issue('a'), issue('b')], [issue('a')], { ...quality, maxNewA11yIssues: 1 }).status).toBe('warn');
  });

  it('perf and visual can only warn; coverage and bundle can fail', () => {
    expect(perfCheck({ lcpMs: 9000 }, quality).status).toBe('warn');
    expect(perfCheck(null, quality).status).toBe('skipped');
    expect(visualCheck([{ label: 'home', pct: 80 }], quality).status).toBe('warn');
    expect(coverageCheck(80, 83, quality).status).toBe('fail');
    expect(coverageCheck(82.5, 83, quality).status).toBe('pass');
    expect(bundleCheck(120_000, 100_000, quality).status).toBe('fail');
    expect(bundleCheck(105_000, 100_000, quality).summary).toContain('+5%');
  });

  it('reads coverage summaries and lcov, and sums build output', () => {
    const dir = tmp('agentroom-cov-');
    fs.mkdirSync(path.join(dir, 'coverage'));
    fs.writeFileSync(path.join(dir, 'coverage/lcov.info'), 'SF:a\nLF:10\nLH:7\nend_of_record\nSF:b\nLF:10\nLH:10\n');
    expect(readCoverage(dir)).toBe(85);
    fs.writeFileSync(path.join(dir, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 91.2 } } }));
    expect(readCoverage(dir)).toBe(91.2);
    fs.mkdirSync(path.join(dir, 'dist/assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist/assets/a.js'), 'x'.repeat(1000));
    fs.writeFileSync(path.join(dir, 'dist/assets/a.js.map'), 'x'.repeat(5000));
    fs.writeFileSync(path.join(dir, 'dist/a.css'), 'x'.repeat(200));
    expect(bundleBytes(dir)).toBe(1200);
  });

  it('adds failing checks to the risk score and summarizes reports', () => {
    const risk: RiskAssessment = { score: 30, level: 'low', factors: [{ label: '100 changed lines', points: 30 }], files: 2, additions: 90, deletions: 10, computedAt: '' };
    const r = withQuality(risk, { round: 0, status: 'passed', at: '', summary: '', failing: ['Accessibility', 'Coverage'] });
    expect(r.score).toBe(50);
    expect(r.level).toBe('medium');
    expect(withQuality(r, { round: 1, status: 'passed', at: '', summary: '', failing: [] }).score).toBe(30);

    const report: ProofReport = {
      goalId: 'G-1',
      round: 0,
      status: 'passed',
      startedAt: '',
      finishedAt: 'now',
      scenarios: [{ name: 'Export', ok: true, frames: [{ file: 's0-00.png', label: 'Page loaded', step: -1, ok: true }], before: [], gif: 's0.gif' }],
      checks: [a11yCheck([issue('x')], [], quality)],
    };
    const s = summarize(report);
    expect(s.failing).toEqual(['Accessibility']);
    expect(s.gif).toBe(true);
    expect(s.summary).toContain('1 scenario passed');
  });
});

describe('dev server detection', () => {
  it('finds the dev script and the framework port flag', () => {
    const dir = tmp('agentroom-app-');
    expect(detectApp(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6' } }));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const app = detectApp(dir)!;
    expect(app).toEqual({ command: 'pnpm run dev', framework: 'vite' });
    expect(portArgs(app.framework, 4100, app.command)).toBe(' -- --port 4100 --strictPort --host 127.0.0.1');
    expect(portArgs('next', 4100, 'yarn dev')).toBe(' -p 4100');
    expect(detectApp(dir, 'make serve')!.command).toBe('make serve');
  });
});

describe('proof branch publishing', () => {
  it('commits proof files onto an orphan branch without touching the working copy, and pushes', () => {
    const repo = tmp('agentroom-pub-');
    const remote = tmp('agentroom-remote-');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    git(remote, 'init', '--bare', '-q');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'app.txt'), 'hi');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'remote', 'add', 'origin', remote);
    const files = path.join(tmp('agentroom-files-'), 'a.gif');
    fs.writeFileSync(files, 'GIF89a');

    return (async () => {
      const first = await publishProof(repo, 'G-1-r0', [{ name: 'a.gif', path: files }], 'Proof G-1');
      const second = await publishProof(repo, 'G-2-r0', [{ name: 'a.gif', path: files }], 'Proof G-2');
      expect(git(remote, 'rev-parse', `refs/heads/${PROOF_BRANCH}`)).toBe(second);
      expect(git(remote, 'rev-parse', `${second}^`)).toBe(first);
      expect(git(remote, 'ls-tree', '-r', '--name-only', second).split('\n').sort()).toEqual(['G-1-r0/a.gif', 'G-2-r0/a.gif', 'README.md']);
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
      expect(rawUrl('o/r', second, 'G-1-r0/a.gif')).toBe(`https://github.com/o/r/blob/${second}/G-1-r0/a.gif?raw=true`);
      await expect(publishProof(repo, '../x', [], 'bad', { push: false })).rejects.toThrow();
    })();
  });
});

describe('ProofService', () => {
  it('stores scenarios, serves only its own files and writes the PR section', () => {
    const runs = tmp('agentroom-runs-');
    const settings = SettingsSchema.parse({});
    const proof = new ProofService({ root: runs, runsDir: runs, settings: () => settings, scratchDir: tmp('agentroom-scratch-') });
    expect(() => proof.setScenarios('G-1', [{ path: 'https://evil.example' }])).toThrow();
    expect(proof.setScenarios('G-1', [{ name: 'Home', path: '/', steps: [{ action: 'expect', value: 'Welcome' }] }])).toHaveLength(1);
    expect(proof.scenarios('G-1')[0].name).toBe('Home');
    expect(proof.file('G-1', '../../etc/passwd')).toBeNull();
    expect(proof.file('G-1', 'scenarios.json')).not.toBeNull();

    const report: ProofReport = {
      goalId: 'G-1',
      round: 0,
      status: 'passed',
      startedAt: '',
      finishedAt: '',
      scenarios: [{ name: 'Home', ok: true, gif: 's0.gif', frames: [{ file: 's0-00.png', label: 'Page loaded', step: -1, ok: true }], before: [{ file: 'before-s0-00.png', label: 'Page loaded', step: -1, ok: true }] }],
      checks: [perfCheck({ lcpMs: 800 }, settings.quality)],
    };
    fs.writeFileSync(path.join(proof.dir('G-1'), 'report.json'), JSON.stringify(report));
    const local = proof.markdown('G-1', 'o/r')!;
    expect(local).toContain('### Proof');
    expect(local).toContain('✅ Home');
    expect(local).toContain(PROOF_MARK);
    expect(local).not.toContain('![');
    fs.writeFileSync(path.join(proof.dir('G-1'), 'report.json'), JSON.stringify({ ...report, published: { branch: PROOF_BRANCH, sha: 'abc', base: 'G-1-r0' } }));
    const published = proof.markdown('G-1', 'o/r')!;
    expect(published).toContain('https://github.com/o/r/blob/abc/G-1-r0/s0.gif?raw=true');
    expect(published).toContain('| Before | After |');
    expect(published).not.toContain(PROOF_MARK);
  });

  it('accepts the query token only for proof images (like uploads)', async () => {
    const { Hono } = await import('hono');
    const { requireToken } = await import('../src/server/http/auth.js');
    const app = new Hono();
    app.use('*', requireToken('secret'));
    app.get('*', (c) => c.text('ok'));
    const status = async (p: string) => (await app.request(p)).status;
    expect(await status('/goals/G-1/proof/files/s0.gif?t=secret')).toBe(200);
    expect(await status('/goals/G-1/proof/files/s0-00.png?t=secret')).toBe(200);
    expect(await status('/goals/G-1/proof/files/report.json?t=secret')).toBe(401);
    expect(await status('/goals/G-1/proof?t=secret')).toBe(401);
  });

  it('puts extra sections into the PR body before the footer', () => {
    const goal = { id: 'G-1', summary: 'Did it', plan: '', brief: '', sources: [] } as unknown as Parameters<typeof buildPrBody>[0];
    const body = buildPrBody(goal, [], 0, undefined, ['### Proof\n\nok']);
    expect(body.indexOf('### Proof')).toBeLessThan(body.indexOf('Made with AgentRoom'));
  });
});
