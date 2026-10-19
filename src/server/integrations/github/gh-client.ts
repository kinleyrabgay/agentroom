import { execFile } from 'node:child_process';

/** Minimal GitHub GraphQL access; implemented by the `gh` CLI in production, faked in tests. */
export interface GhClient {
  graphql<T>(query: string, variables?: Record<string, string | number | boolean | null | undefined>): Promise<T>;
}

/** Thrown with a message the UI can show as-is. */
export class GhError extends Error {}

const SCOPE_HINT = 'Run `gh auth refresh -s project` (or `gh auth login`) and try again.';

/** Turn gh's stderr into an actionable message. */
export function explainGhError(stderr: string, code?: string): string {
  if (code === 'ENOENT') return 'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.';
  const text = stderr.trim();
  if (/not logged|auth login|authentication|401|bad credentials/i.test(text)) return `GitHub CLI isn't logged in. ${SCOPE_HINT}`;
  if (/scope|INSUFFICIENT_SCOPES|read:project|\bproject\b.*permission/i.test(text)) return `The GitHub token is missing the "project" scope. ${SCOPE_HINT}`;
  if (/Could not resolve to a ProjectV2|NOT_FOUND/i.test(text)) return 'Project not found, or you have no access to it.';
  return text.split('\n').find((l) => l.trim()) ?? 'GitHub request failed.';
}

/** Runs `gh api graphql` with argv (never a shell). Numbers/booleans go as -F, strings as -f. */
export class GhCliClient implements GhClient {
  constructor(private readonly timeoutMs = 30_000) {}

  graphql<T>(query: string, variables: Record<string, string | number | boolean | null | undefined> = {}): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [k, v] of Object.entries(variables)) {
      if (v === undefined || v === null) continue;
      args.push(typeof v === 'string' ? '-f' : '-F', `${k}=${v}`);
    }
    return new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: this.timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          reject(new GhError(explainGhError(String(stderr || stdout || err.message), typeof code === 'string' ? code : undefined)));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { data?: T; errors?: { message: string; type?: string }[] };
          if (parsed.errors?.length && !parsed.data) {
            reject(new GhError(explainGhError(parsed.errors.map((e) => `${e.type ?? ''} ${e.message}`).join('\n'))));
            return;
          }
          resolve(parsed.data as T);
        } catch {
          reject(new GhError('Unexpected response from the GitHub CLI.'));
        }
      });
    });
  }
}
