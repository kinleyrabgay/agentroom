import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { designFromFields, designReference, parseFigmaUrl, parseSize } from '../src/server/autopilot/design.js';
import { compareDesign, designCheck, diffImage, encodePng } from '../src/server/proof/design-match.js';
import { decodePng, resize, type Bitmap } from '../src/server/proof/image.js';

/** A simple "screen": white page, a dark header bar, a coloured card and a button. */
function screen(w: number, h: number, opts: { cardX?: number; button?: boolean; header?: [number, number, number] } = {}): Bitmap {
  const data = new Uint8Array(w * h * 4).fill(255);
  const rect = (x0: number, y0: number, rw: number, rh: number, c: [number, number, number]) => {
    for (let y = y0; y < Math.min(h, y0 + rh); y++) for (let x = x0; x < Math.min(w, x0 + rw); x++) {
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
    }
  };
  const s = w / 400;
  rect(0, 0, w, Math.round(40 * s), opts.header ?? [20, 30, 40]);
  rect(Math.round((opts.cardX ?? 40) * s), Math.round(80 * s), Math.round(200 * s), Math.round(120 * s), [0, 128, 128]);
  if (opts.button !== false) rect(Math.round(40 * s), Math.round(230 * s), Math.round(90 * s), Math.round(30 * s), [230, 90, 40]);
  return { width: w, height: h, data };
}

describe('Figma links and design fields', () => {
  it('parses frame links', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbCdEf123456/App?node-id=12-345&t=x')).toEqual({ fileKey: 'AbCdEf123456', nodeId: '12:345' });
    expect(parseFigmaUrl('https://figma.com/file/AbCdEf123456/App')).toEqual({ fileKey: 'AbCdEf123456' });
    expect(parseFigmaUrl('https://evil.com/design/AbCdEf123456/App?node-id=1-2')).toBeNull();
    expect(parseFigmaUrl('not a url')).toBeNull();
  });

  it('parses frame sizes', () => {
    expect(parseSize('1440x900')).toEqual({ width: 1440, height: 900 });
    expect(parseSize(' 1280 × 720 px')).toEqual({ width: 1280, height: 720 });
    expect(parseSize('390')).toEqual({ width: 390 });
    expect(parseSize('99999x1')).toEqual({});
    expect(parseSize('')).toEqual({});
  });

  it('builds the design spec from template fields', () => {
    const t = { design: true, fields: [{ id: 'figma', label: 'f' }, { id: 'image', label: 'i', image: true }, { id: 'page', label: 'p' }, { id: 'size', label: 's' }] };
    expect(designFromFields(t, { figma: 'https://www.figma.com/design/AbCdEf123456/App?node-id=1-2', page: '/pricing', size: '1440x900' })).toEqual({
      source: 'figma', figmaUrl: 'https://www.figma.com/design/AbCdEf123456/App?node-id=1-2', fileKey: 'AbCdEf123456', nodeId: '1:2', path: '/pricing', width: 1440, height: 900,
    });
    expect(designFromFields(t, { image: 'up_123', page: '/' })).toEqual({ source: 'upload', uploadId: 'up_123', path: '/' });
    expect(() => designFromFields(t, { page: '/' })).toThrow(/Figma frame link or a design image/);
    expect(() => designFromFields(t, { image: 'up_1', page: 'pricing' })).toThrow(/path/);
    expect(() => designFromFields(t, { figma: 'https://www.figma.com/design/AbCdEf123456/App', page: '/' })).toThrow(/node-id/);
    expect(designFromFields({ design: false, fields: [] }, {})).toBeUndefined();
  });
});

describe('design match', () => {
  it('scores an identical page ~100 and is size-normalised (2× export vs 1× page)', () => {
    const page = screen(400, 300);
    expect(compareDesign(page, page).score).toBe(100);
    const twoX = resize(screen(800, 600), 800, 600);
    expect(compareDesign(twoX, page).score).toBeGreaterThanOrEqual(95);
  });

  it('scores a different layout lower, and a very different one much lower', () => {
    const design = screen(400, 300);
    const shifted = compareDesign(design, screen(400, 300, { cardX: 150 })).score;
    const missing = compareDesign(design, screen(400, 300, { button: false, header: [240, 240, 240], cardX: 180 })).score;
    expect(shifted).toBeLessThan(100);
    expect(missing).toBeLessThan(shifted);
  });

  it('is not fooled by empty background around a misplaced element', () => {
    // A sparse page: one button on white. Moving it a lot must cost far more than the 1–2% of pixels involved.
    const sparse = (x: number): Bitmap => {
      const w = 400
      const h = 300
      const data = new Uint8Array(w * h * 4).fill(255)
      for (let y = 40; y < 70; y++) for (let xx = x; xx < x + 90; xx++) {
        const i = (y * w + xx) * 4
        data[i] = 230
        data[i + 1] = 90
        data[i + 2] = 40
      }
      return { width: w, height: h, data }
    }
    expect(compareDesign(sparse(40), sparse(40)).score).toBe(100)
    expect(compareDesign(sparse(40), sparse(260)).score).toBeLessThan(70)
  })

  it('penalises a page much longer than the frame', () => {
    const d = screen(400, 300);
    expect(compareDesign(d, d, 600, 300).proportions).toBe(50);
    expect(compareDesign(d, d, 600, 300).score).toBeLessThan(compareDesign(d, d, 300, 300).score);
  });

  it('encodes PNGs that decode back, and marks differences in the diff image', () => {
    const a = screen(120, 90);
    const round = decodePng(encodePng(a));
    expect(round.width).toBe(120);
    expect(Buffer.from(round.data).equals(Buffer.from(a.data))).toBe(true);
    const diff = diffImage(a, screen(120, 90, { cardX: 150 }));
    const red = Array.from({ length: diff.width * diff.height }, (_, i) => diff.data[i * 4] === 224 && diff.data[i * 4 + 1] === 49).filter(Boolean).length;
    expect(red).toBeGreaterThan(0);
  });

  it('turns the score into a check against the threshold', () => {
    const m = { reference: 'r', shot: 's', score: 64, pixelMatch: 70, structure: 60, proportions: 100, width: 1440, height: 900, source: 'upload' as const, path: '/' };
    expect(designCheck(m, 70)).toMatchObject({ id: 'design', status: 'fail', value: 64, threshold: 70 });
    expect(designCheck({ ...m, score: 82 }, 70).status).toBe('pass');
    expect(designCheck({ ...m, error: 'no token' }, 70).status).toBe('skipped');
  });
});

describe('design reference', () => {
  it('copies an uploaded design once and reuses the cached copy', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-design-'));
    const upload = path.join(dir, 'upload.jpg');
    fs.writeFileSync(upload, 'jpeg-bytes');
    const out = path.join(dir, 'proof');
    const ref = await designReference({ source: 'upload', uploadId: 'u1', path: '/' }, out, { uploadPath: () => upload, figmaToken: () => undefined });
    expect(path.basename(ref.file)).toBe('design-source.jpg');
    fs.rmSync(upload);
    const again = await designReference({ source: 'upload', uploadId: 'u1', path: '/' }, out, { uploadPath: () => undefined, figmaToken: () => undefined });
    expect(again.file).toBe(ref.file);
  });

  it('exports a Figma frame with the REST API (read-only) and reads its size', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-design-'));
    const calls: { url: string; token?: string }[] = [];
    const png = encodePng(screen(40, 30));
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, token: init?.headers?.['X-Figma-Token'] });
      if (url.includes('/v1/images/')) return new Response(JSON.stringify({ err: null, images: { '1:2': 'https://cdn.figma.test/frame.png' } }));
      if (url.includes('/nodes')) return new Response(JSON.stringify({ nodes: { '1:2': { document: { absoluteBoundingBox: { width: 1440, height: 1024 } } } } }));
      return new Response(new Uint8Array(png));
    }) as unknown as typeof fetch;
    const ref = await designReference({ source: 'figma', fileKey: 'AbCdEf123456', nodeId: '1:2', path: '/' }, dir, { uploadPath: () => undefined, figmaToken: () => 'figd_test', fetchImpl });
    expect(ref).toMatchObject({ width: 1440, height: 1024 });
    expect(fs.readFileSync(ref.file).equals(png)).toBe(true);
    expect(calls[0]).toMatchObject({ url: 'https://api.figma.com/v1/images/AbCdEf123456?ids=1%3A2&format=png&scale=1', token: 'figd_test' });
    expect(calls.every((c) => !c.url.includes('method=') && c.url.startsWith('https://'))).toBe(true);
  });

  it('explains what to add when there is no token and no image', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-design-'));
    await expect(designReference({ source: 'figma', fileKey: 'AbCdEf123456', nodeId: '1:2', path: '/' }, dir, { uploadPath: () => undefined, figmaToken: () => undefined })).rejects.toThrow(/FIGMA_ACCESS_TOKEN/);
  });
});
