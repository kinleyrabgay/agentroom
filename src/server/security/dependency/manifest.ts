import type { FileDiff } from '../diff.js';

export interface DependencyChange {
  name: string;
  /** Range as written in package.json. */
  range: string;
  /** Concrete version (from the lockfile, else the lowest version in the range). */
  version: string;
  manifest: string;
}

export const MANIFEST = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/;

/** Fields in package.json that look like `"key": "value"` but aren't dependencies. */
const NON_DEP_KEYS = new Set([
  'name', 'version', 'description', 'main', 'module', 'browser', 'types', 'typings', 'license', 'author', 'type',
  'homepage', 'packageManager', 'node', 'npm', 'yarn', 'pnpm', 'url', 'email', 'directory', 'bin', 'exports',
]);
const DEP_LINE = /^\s*"((?:@[\w.-]+\/)?[\w.-]+)"\s*:\s*"([^"]+)"/;
/** A version range or a dependency specifier (not a script command). */
const RANGE = /^([\^~]?\d|[<>=]|\*$|x$|latest$|next$|workspace:|npm:|file:|link:|git(\+|:)|https?:|github:)/;

/** Dependencies a diff adds or changes in package.json files. */
export function changedDependencies(files: FileDiff[], lockVersion: (manifest: string, name: string) => string | null): DependencyChange[] {
  const out: DependencyChange[] = [];
  for (const f of files) {
    if (!/(^|\/)package\.json$/.test(f.path) || f.isDeleted) continue;
    for (const { text } of f.added) {
      const m = DEP_LINE.exec(text);
      if (!m || NON_DEP_KEYS.has(m[1]) || !RANGE.test(m[2]) || (m[2].includes(' ') && !/[<>=]/.test(m[2]))) continue;
      out.push({ name: m[1], range: m[2], version: lockVersion(f.path, m[1]) ?? minVersion(m[2]), manifest: f.path });
    }
  }
  return out;
}

/** Lowest concrete version a range names ("^1.2.3" → "1.2.3"); "" when it can't tell. */
export function minVersion(range: string): string {
  const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(range);
  if (!m) return '';
  const part = (p?: string) => (p && /^\d+$/.test(p) ? p : '0');
  return `${m[1]}.${part(m[2])}.${part(m[3])}`;
}
