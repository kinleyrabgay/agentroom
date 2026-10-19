import path from 'node:path';
import { AttachmentKind } from '../../shared/enums.js';

/** Text attachments above this size are kept as files (read with tools) instead of inlined. */
export const TEXT_INLINE_MAX_BYTES = 200 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml', '.toml', '.ini', '.env.example', '.xml', '.html', '.htm',
  '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.sh', '.bash', '.zsh', '.sql', '.graphql', '.gql', '.log', '.diff', '.patch',
  '.svg', '.dockerfile', '.gitignore',
]);

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Image type from magic bytes (not the declared mime, which the browser may guess). */
export function sniffImage(b: Buffer): ImageMime | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export const isPdf = (b: Buffer) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-';

function isUtf8Text(b: Buffer): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

function looksTextual(name: string, mime: string): boolean {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name).toLowerCase();
  return (
    mime.startsWith('text/') ||
    /(json|xml|yaml|javascript|typescript|csv|markdown|sql|x-sh)/.test(mime) ||
    TEXT_EXTENSIONS.has(ext) ||
    base === 'dockerfile' ||
    base === 'makefile'
  );
}

export interface Detected {
  kind: AttachmentKind;
  /** Normalized mime (sniffed for images and PDFs). */
  mime: string;
  width?: number;
  height?: number;
}

/** Decide how an upload reaches the model: image block, PDF document block, inlined text, or a file path. */
export function detect(bytes: Buffer, declaredMime: string, name: string): Detected {
  const image = sniffImage(bytes);
  if (image) return { kind: AttachmentKind.Image, mime: image, ...(imageSize(bytes, image) ?? {}) };
  if (isPdf(bytes)) return { kind: AttachmentKind.Pdf, mime: 'application/pdf' };
  const mime = declaredMime || 'application/octet-stream';
  if (bytes.length <= TEXT_INLINE_MAX_BYTES && looksTextual(name, mime) && isUtf8Text(bytes)) {
    return { kind: AttachmentKind.Text, mime: mime === 'application/octet-stream' ? 'text/plain' : mime };
  }
  return { kind: AttachmentKind.File, mime };
}

/** Pixel size from image headers (PNG IHDR, GIF screen descriptor, JPEG SOFn, WebP VP8/VP8L/VP8X). */
export function imageSize(b: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    switch (mime) {
      case 'image/png':
        return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
      case 'image/gif':
        return b.length >= 10 ? { width: b.readUInt16LE(6), height: b.readUInt16LE(8) } : null;
      case 'image/jpeg':
        return jpegSize(b);
      case 'image/webp':
        return webpSize(b);
    }
  } catch {
    return null;
  }
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Buffer): { width: number; height: number } | null {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
