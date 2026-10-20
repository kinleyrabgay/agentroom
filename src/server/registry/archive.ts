import path from 'node:path';
import zlib from 'node:zlib';

/** A skill's files, keyed by safe relative path ("SKILL.md", "scripts/check.sh"). */
export type FileMap = Map<string, Buffer>;

export const LIMITS = { files: 200, fileBytes: 1_000_000, totalBytes: 5_000_000 } as const;

/** Reject absolute paths, `..`, and odd characters. Returns the normalised path. */
export function safeRelPath(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm || norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) throw new Error(`unsafe path in archive: ${p}`);
  const parts = norm.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new Error(`unsafe path in archive: ${p}`);
  return parts.join('/');
}

function addFile(files: FileMap, name: string, data: Buffer, total: { n: number }) {
  const rel = safeRelPath(name);
  if (!rel) return;
  if (files.size >= LIMITS.files) throw new Error(`archive has more than ${LIMITS.files} files`);
  if (data.length > LIMITS.fileBytes) throw new Error(`${rel} is larger than ${LIMITS.fileBytes / 1_000_000} MB`);
  total.n += data.length;
  if (total.n > LIMITS.totalBytes) throw new Error(`archive is larger than ${LIMITS.totalBytes / 1_000_000} MB`);
  files.set(rel, data);
}

// ---------- tar (ustar) ----------

/** Deterministic .tar.gz: sorted paths, mtime 0, mode 0644, so the same files give the same sha256. */
export function writeTarGz(files: FileMap): Buffer {
  const blocks: Buffer[] = [];
  for (const name of [...files.keys()].sort()) {
    const data = files.get(name)!;
    const header = Buffer.alloc(512);
    let base = name;
    let prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const cut = name.lastIndexOf('/', 154);
      if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`path too long for tar: ${name}`);
      prefix = name.slice(0, cut);
      base = name.slice(cut + 1);
    }
    header.write(base, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.write('        ', 148, 8, 'ascii');
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}

function cString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? len : end).toString('utf8');
}

/** Read a .tar or .tar.gz. Only regular files; links and devices are refused. */
export function readTar(input: Buffer): FileMap {
  const buf = input[0] === 0x1f && input[1] === 0x8b ? zlib.gunzipSync(input, { maxOutputLength: LIMITS.totalBytes * 2 }) : input;
  const files: FileMap = new Map();
  const total = { n: 0 };
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(cString(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = cString(header, 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${cString(header, 0, 100)}` : cString(header, 0, 100));
    longName = null;
    const dataStart = off + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = cString(data, 0, data.length);
      continue;
    }
    if (type === 'x' || type === 'g' || type === '5') continue;
    if (type !== '0' && type !== '\0' && type !== '7') throw new Error(`archive contains a link or special file: ${name}`);
    name = name.replace(/^package\//, '');
    addFile(files, name, Buffer.from(data), total);
  }
  return files;
}

// ---------- zip (read only) ----------

/** Read a .zip (stored or deflate). Used for skills downloaded from marketplaces. */
export function readZip(buf: Buffer): FileMap {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files: FileMap = new Map();
  const total = { n: 0 };
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const externalAttr = buf.readUInt32LE(off + 38);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || path.basename(name) === '.DS_Store') continue;
    // Unix symlink bit in the high word of the external attributes.
    if (((externalAttr >>> 16) & 0o170000) === 0o120000) throw new Error(`zip contains a symlink: ${name}`);
    if (size > LIMITS.fileBytes) throw new Error(`${name} is larger than ${LIMITS.fileBytes / 1_000_000} MB`);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('corrupt zip entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.fileBytes });
    else throw new Error(`unsupported zip compression (${method}) for ${name}`);
    addFile(files, name, data, total);
  }
  return files;
}

/**
 * Narrow a file set to one skill: the folder holding the shallowest SKILL.md
 * (or the one whose folder matches `want`). Paths become relative to it.
 */
export function skillRoot(files: FileMap, want?: string): FileMap {
  const candidates = [...files.keys()].filter((p) => path.posix.basename(p) === 'SKILL.md');
  if (!candidates.length) throw new Error('no SKILL.md found');
  const pick =
    (want && candidates.find((p) => path.posix.basename(path.posix.dirname(p)) === want)) ||
    candidates.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0]!;
  const dir = path.posix.dirname(pick);
  if (dir === '.') return files;
  const out: FileMap = new Map();
  for (const [p, d] of files) if (p.startsWith(`${dir}/`)) out.set(p.slice(dir.length + 1), d);
  return out;
}
