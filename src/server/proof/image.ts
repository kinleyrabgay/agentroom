import zlib from 'node:zlib';

/** An RGBA bitmap (4 bytes per pixel, row-major). */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decode an 8-bit, non-interlaced PNG (what browsers produce for screenshots) to RGBA.
 * Supports greyscale, RGB, palette, grey+alpha and RGBA colour types.
 */
export function decodePng(buf: Buffer): Bitmap {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported`);
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type} is not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    unfilter(filter, line, prev, channels);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (type === 6) {
        out[o] = line[i];
        out[o + 1] = line[i + 1];
        out[o + 2] = line[i + 2];
        out[o + 3] = line[i + 3];
      } else if (type === 2) {
        out[o] = line[i];
        out[o + 1] = line[i + 1];
        out[o + 2] = line[i + 2];
        out[o + 3] = 255;
      } else if (type === 0 || type === 4) {
        out[o] = out[o + 1] = out[o + 2] = line[i];
        out[o + 3] = type === 4 ? line[i + 1] : 255;
      } else {
        const p = line[i] * 3;
        out[o] = palette?.[p] ?? 0;
        out[o + 1] = palette?.[p + 1] ?? 0;
        out[o + 2] = palette?.[p + 2] ?? 0;
        out[o + 3] = trns && line[i] < trns.length ? trns[line[i]] : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let add = 0;
    if (filter === 1) add = a;
    else if (filter === 2) add = b;
    else if (filter === 3) add = (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    line[i] = (line[i] + add) & 0xff;
  }
}

/** Box-filter downscale so the longest side fits; never upscales. */
export function fit(img: Bitmap, maxWidth: number, maxHeight = Infinity): Bitmap {
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  if (scale >= 1) return img;
  return resize(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
}

/** Resize to an exact size (area average when shrinking, nearest when growing). */
export function resize(img: Bitmap, width: number, height: number): Bitmap {
  if (img.width === width && img.height === height) return img;
  const out = new Uint8Array(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width, height, data: out };
}

/**
 * Share of pixels that differ noticeably (0–100). Images of different sizes are compared at the
 * smaller one's size; anti-aliasing noise below `tolerance` (per channel) is ignored.
 */
export function diffPercent(a: Bitmap, b: Bitmap, tolerance = 24): number {
  const w = Math.min(a.width, b.width, 480);
  const scale = w / a.width;
  const h = Math.max(1, Math.round(Math.min(a.height * scale, b.height * (w / b.width))));
  const ra = resize(a, w, h);
  const rb = resize(b, w, h);
  let changed = 0;
  for (let i = 0; i < ra.data.length; i += 4) {
    if (
      Math.abs(ra.data[i] - rb.data[i]) > tolerance ||
      Math.abs(ra.data[i + 1] - rb.data[i + 1]) > tolerance ||
      Math.abs(ra.data[i + 2] - rb.data[i + 2]) > tolerance
    ) {
      changed++;
    }
  }
  return Math.round((changed / (w * h)) * 1000) / 10;
}

// ---------- GIF ----------

/** 6×7×6 colour cube (252 colours) + 4 greys: good enough for UI screenshots, no per-frame quantising. */
const LEVELS_R = [0, 51, 102, 153, 204, 255];
const LEVELS_G = [0, 42, 85, 128, 170, 213, 255];
const LEVELS_B = [0, 51, 102, 153, 204, 255];
const GREYS = [34, 68, 238, 245];

function buildPalette(): Uint8Array {
  const p = new Uint8Array(256 * 3);
  let n = 0;
  for (const r of LEVELS_R) for (const g of LEVELS_G) for (const b of LEVELS_B) {
    p[n * 3] = r;
    p[n * 3 + 1] = g;
    p[n * 3 + 2] = b;
    n++;
  }
  for (const v of GREYS) {
    p[n * 3] = p[n * 3 + 1] = p[n * 3 + 2] = v;
    n++;
  }
  return p;
}
const PALETTE = buildPalette();

const nearest = (v: number, levels: number[]) => {
  let best = 0;
  for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i] - v) < Math.abs(levels[best] - v)) best = i;
  return best;
};
const LUT_R = Array.from({ length: 256 }, (_, v) => nearest(v, LEVELS_R));
const LUT_G = Array.from({ length: 256 }, (_, v) => nearest(v, LEVELS_G));
const LUT_B = Array.from({ length: 256 }, (_, v) => nearest(v, LEVELS_B));

function indexOf(r: number, g: number, b: number): number {
  // Near-neutral light/dark tones map to the extra greys (UI backgrounds look far better).
  if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6) {
    for (let i = 0; i < GREYS.length; i++) if (Math.abs(GREYS[i] - r) < 5) return 252 + i;
  }
  return (LUT_R[r] * 7 + LUT_G[g]) * 6 + LUT_B[b];
}

/** Map RGBA to palette indices, compositing transparency on white. */
function toIndices(img: Bitmap): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const a = img.data[i + 3] / 255;
    const r = Math.round(img.data[i] * a + 255 * (1 - a));
    const g = Math.round(img.data[i + 1] * a + 255 * (1 - a));
    const b = Math.round(img.data[i + 2] * a + 255 * (1 - a));
    out[p] = indexOf(r, g, b);
  }
  return out;
}

/** GIF LZW (8-bit codes), packed into 255-byte sub-blocks. */
function lzw(indices: Uint8Array): Buffer {
  const minCode = 8;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const bytes: number[] = [];
  let cur = 0;
  let bits = 0;
  let size = minCode + 1;
  const emit = (code: number) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(cur & 0xff);
      cur >>>= 8;
      bits -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) bytes.push(cur & 0xff);
  const blocks: number[] = [minCode];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return Buffer.from(blocks);
}

/**
 * Encode frames as a looping GIF. Frames are scaled to the first frame's size (after `maxWidth`).
 * `delays` are per-frame in milliseconds (default 1200, the last frame holds twice as long).
 */
export function encodeGif(frames: Bitmap[], opts: { maxWidth?: number; delays?: number[] } = {}): Buffer {
  if (!frames.length) throw new Error('no frames');
  const first = fit(frames[0], opts.maxWidth ?? 960);
  const { width, height } = first;
  const parts: Buffer[] = [];
  const header = Buffer.alloc(13);
  header.write('GIF89a', 0, 'latin1');
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0xf7; // global colour table, 8 bits, 256 entries
  parts.push(header, Buffer.from(PALETTE));
  // Loop forever (NETSCAPE2.0).
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, 0x00, 0x00, 0x00]));
  frames.forEach((f, i) => {
    const img = resize(f, width, height);
    const delay = Math.round((opts.delays?.[i] ?? (i === frames.length - 1 ? 2400 : 1200)) / 10);
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 0xff, delay >> 8, 0x00, 0x00]));
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(width, 5);
    desc.writeUInt16LE(height, 7);
    parts.push(desc, lzw(toIndices(img)));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
