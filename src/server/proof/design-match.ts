import { deflateSync } from 'node:zlib';
import type { ProofCheck } from '../../shared/types/index.js';
import type { DesignMatch } from '../../shared/types/index.js';
import { resize, type Bitmap } from './image.js';

/** Width both images are scaled to before comparing pixels (size-normalised, cheap, stable). */
const COMPARE_WIDTH = 256;
/** Structure is compared coarser, so a few pixels of offset cost little but a moved section still counts. */
const STRUCTURE_WIDTH = 128;
const TOLERANCE = 32;
const WINDOW = 8;

export interface DesignScore {
  score: number;
  pixelMatch: number;
  structure: number;
  proportions: number;
}

/**
 * How closely the rendered page matches the design, 0–100. Both images are scaled to the same width
 * (so a 2× export compares fine with a 1× page) and compared over their common height:
 * structure (SSIM on luminance, 8×8 windows) 55%, pixel match 30%, proportions 15%.
 * Structure and pixels are measured only where either image has content (windows with detail), so
 * empty background doesn't water down a misplaced button.
 * `pageHeight` is the page's full scroll height at the frame's width (null: assume it matches).
 */
export function compareDesign(reference: Bitmap, page: Bitmap, pageHeight: number | null = null, frameHeight: number | null = null): DesignScore {
  const w = Math.min(COMPARE_WIDTH, reference.width, page.width);
  const hr = Math.max(1, Math.round((reference.height * w) / reference.width));
  const hp = Math.max(1, Math.round((page.height * w) / page.width));
  const h = Math.min(hr, hp);
  const a = crop(resize(reference, w, hr), h);
  const b = crop(resize(page, w, hp), h);

  const { content } = ssim(luma(a), luma(b), w, h);
  const sw = Math.min(STRUCTURE_WIDTH, w);
  const sh = Math.max(1, Math.round((h * sw) / w));
  const { mean } = ssim(luma(resize(a, sw, sh)), luma(resize(b, sw, sh)), sw, sh);
  let same = 0;
  let counted = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (content && !content[Math.floor(y / WINDOW) * Math.ceil(w / WINDOW) + Math.floor(x / WINDOW)]) continue;
      const i = (y * w + x) * 4;
      counted++;
      if (Math.abs(a.data[i] - b.data[i]) <= TOLERANCE && Math.abs(a.data[i + 1] - b.data[i + 1]) <= TOLERANCE && Math.abs(a.data[i + 2] - b.data[i + 2]) <= TOLERANCE) same++;
    }
  }
  const pixelMatch = round1(counted ? (same / counted) * 100 : 100);
  const structure = round1(Math.max(0, mean) * 100);
  const ratio = (x: number, y: number) => (Math.min(x, y) / Math.max(x, y)) * 100;
  const proportions = round1(pageHeight && frameHeight ? ratio(pageHeight, frameHeight) : ratio(hr, hp));
  const score = Math.round(0.55 * structure + 0.3 * pixelMatch + 0.15 * proportions);
  return { score, pixelMatch, structure, proportions };
}

/** A picture of where they differ: the page faded to grey with differing pixels in red. */
export function diffImage(reference: Bitmap, page: Bitmap, maxWidth = 720): Bitmap {
  const w = Math.min(maxWidth, page.width);
  const hp = Math.max(1, Math.round((page.height * w) / page.width));
  const hr = Math.max(1, Math.round((reference.height * w) / reference.width));
  const h = Math.min(hp, hr);
  const p = crop(resize(page, w, hp), h);
  const r = crop(resize(reference, w, hr), h);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    const differs = Math.abs(p.data[i] - r.data[i]) > TOLERANCE || Math.abs(p.data[i + 1] - r.data[i + 1]) > TOLERANCE || Math.abs(p.data[i + 2] - r.data[i + 2]) > TOLERANCE;
    const g = Math.round(0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]);
    const faded = Math.round(255 - (255 - g) * 0.35);
    if (differs) {
      out[i] = 224;
      out[i + 1] = 49;
      out[i + 2] = 49;
    } else {
      out[i] = out[i + 1] = out[i + 2] = faded;
    }
    out[i + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

/** Quality check row for the design match. */
export function designCheck(m: DesignMatch, minMatch: number): ProofCheck {
  if (m.error) return { id: 'design', label: 'Design match', status: 'skipped', summary: m.error };
  return {
    id: 'design',
    label: 'Design match',
    status: m.score >= minMatch ? 'pass' : 'fail',
    summary: `${m.score}/100 at ${m.width}×${m.height} (structure ${Math.round(m.structure)}, pixels ${Math.round(m.pixelMatch)}, proportions ${Math.round(m.proportions)})`,
    value: m.score,
    threshold: minMatch,
  };
}

// ---------- PNG encoding (for the diff image) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGBA bitmap → PNG (no filtering; fine for small diff images). */
export function encodePng(img: Bitmap): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- helpers ----------

function crop(img: Bitmap, height: number): Bitmap {
  if (img.height === height) return img;
  return { width: img.width, height, data: img.data.subarray(0, img.width * height * 4) };
}

function luma(img: Bitmap): Float64Array {
  const out = new Float64Array(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    // Transparent pixels count as white (design exports often have transparent backgrounds).
    const a = img.data[i + 3] / 255;
    const y = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    out[j] = y * a + 255 * (1 - a);
  }
  return out;
}

/** Windows whose luminance varies less than this (std ≈ 4) in both images are empty background. */
const CONTENT_VAR = 16;

/**
 * Mean SSIM over non-overlapping windows that hold content in either image, plus that content mask
 * (row-major by window; null when nothing has content and every window counted).
 */
function ssim(a: Float64Array, b: Float64Array, w: number, h: number): { mean: number; content: Uint8Array | null } {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const cols = Math.ceil(w / WINDOW);
  const mask = new Uint8Array(cols * Math.ceil(h / WINDOW));
  let total = 0;
  let n = 0;
  let all = 0;
  let allN = 0;
  for (let y0 = 0; y0 < h; y0 += WINDOW) {
    for (let x0 = 0; x0 < w; x0 += WINDOW) {
      const ys = Math.min(WINDOW, h - y0);
      const xs = Math.min(WINDOW, w - x0);
      const count = xs * ys;
      let ma = 0, mb = 0;
      for (let y = y0; y < y0 + ys; y++) for (let x = x0; x < x0 + xs; x++) {
        ma += a[y * w + x];
        mb += b[y * w + x];
      }
      ma /= count;
      mb /= count;
      let va = 0, vb = 0, cov = 0;
      for (let y = y0; y < y0 + ys; y++) for (let x = x0; x < x0 + xs; x++) {
        const da = a[y * w + x] - ma;
        const db = b[y * w + x] - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= count;
      vb /= count;
      cov /= count;
      const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      all += s;
      allN++;
      // Content: detail in either window, or a flat area whose colour differs (a missing block).
      if (va > CONTENT_VAR || vb > CONTENT_VAR || Math.abs(ma - mb) > TOLERANCE) {
        mask[Math.floor(y0 / WINDOW) * cols + Math.floor(x0 / WINDOW)] = 1;
        total += s;
        n++;
      }
    }
  }
  if (!n) return { mean: allN ? all / allN : 0, content: null };
  return { mean: total / n, content: mask };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
