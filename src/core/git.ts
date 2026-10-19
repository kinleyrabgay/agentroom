import { execFileSync } from 'node:child_process';

export function gitBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

let cachedUser: { cwd: string; value: string } | null = null;

/** "Name <email>" from git config, for attributing human approvals. Cached per cwd. */
export function gitUser(cwd: string): string {
  if (cachedUser?.cwd === cwd) return cachedUser.value;
  const get = (key: string) => {
    try {
      return execFileSync('git', ['config', key], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const name = get('user.name');
  const email = get('user.email');
  const value = name && email ? `${name} <${email}>` : name || email || 'human';
  cachedUser = { cwd, value };
  return value;
}
