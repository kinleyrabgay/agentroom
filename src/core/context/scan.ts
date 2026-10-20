import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE_BYTES = 256 * 1024;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.agentroom',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.dart_tool',
  '.gradle',
  'Pods',
  'DerivedData',
]);

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'pubspec.lock',
  'Podfile.lock',
  'flake.lock',
]);

const BINARY_EXT = new Set(
  (
    'png jpg jpeg gif webp avif ico icns bmp tiff psd svgz mp3 mp4 mov webm wav ogg flac m4a avi mkv ' +
    'woff woff2 ttf otf eot pdf zip gz tgz bz2 xz 7z rar jar war class exe dll so dylib a o obj wasm ' +
    'bin dat db sqlite sqlite3 pyc pyo node keystore jks p12 pem der heic sketch fig'
  ).split(' '),
);

const GENERATED = [/\.min\.(js|css)$/, /\.map$/, /\.generated\./, /\.g\.dart$/, /\.freezed\.dart$/, /\.pb\.go$/, /_pb2(_grpc)?\.py$/, /(^|\/)next-env\.d\.ts$/];

/** Whether a repo-relative path is worth indexing, by name alone. */
/**
 * Files that commonly hold secrets. Never indexed, so they are never sent to the card writer
 * or shown in a code peek, even when someone committed one.
 */
const SECRET_FILE = [
  /^\.env($|\.)/i,
  /^\.?(secrets?|credentials?)(\.|$)/i,
  /^\.(npmrc|pypirc|netrc|pgpass|htpasswd|dockercfg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|kdbx)$/i,
  /^service[-_]?account.*\.json$/i,
];

export function isSecretPath(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  return SECRET_FILE.some((r) => r.test(base));
}

export function isIndexablePath(rel: string): boolean {
  const parts = rel.split('/');
  const base = parts[parts.length - 1]!;
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false;
  if (LOCKFILES.has(base) || base === '.DS_Store') return false;
  if (isSecretPath(rel)) return false;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  if (BINARY_EXT.has(ext)) return false;
  return !GENERATED.some((r) => r.test(rel));
}

/** Reads a file for indexing; null when it's too big, binary or gone. */
export function readIndexable(root: string, rel: string): string | null {
  const abs = path.join(root, rel);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return null;
  return buf.toString('utf8');
}

/** Repo-relative paths of files to index: git's view (tracked + untracked, ignores respected), else a walk. */
export function scanFiles(root: string): string[] {
  let list: string[] | null = null;
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    }).toString('utf8');
    list = out.split('\0').filter(Boolean);
  } catch {
    list = null;
  }
  if (!list) list = walk(root);
  const seen = new Set<string>();
  for (const f of list) {
    const rel = f.split(path.sep).join('/');
    if (isIndexablePath(rel)) seen.add(rel);
  }
  return [...seen].sort();
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        visit(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) out.push(rel ? `${rel}/${e.name}` : e.name);
    }
  };
  visit(root, '');
  return out;
}
