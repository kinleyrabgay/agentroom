/** Git/GitHub actions that publish code and therefore pass the security gate. */
export const GitAction = {
  Commit: 'commit',
  Push: 'push',
  PullRequest: 'pull_request',
} as const;
export type GitAction = (typeof GitAction)[keyof typeof GitAction];

/** Which publishing action a shell command performs (first match across `;`, `&&`, `|` segments). */
export function gitActionOf(command: string): GitAction | null {
  for (const raw of command.split(/;|&&|\|\||\||\n/)) {
    const seg = raw.trim().replace(/\s+/g, ' ').replace(/^(\w+=\S*\s+)*/, '').replace(/^(sudo|command|exec|env)\s+/, '');
    // Skip global options like `git -C dir -c k=v commit`.
    const git = /^git((?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*)\s+(\S+)/.exec(seg);
    if (git?.[2] === 'commit') return GitAction.Commit;
    if (git?.[2] === 'push') return GitAction.Push;
    if (/^gh\s+pr\s+create\b/.test(seg)) return GitAction.PullRequest;
  }
  return null;
}

/** `git commit -a` / `--all` commits tracked changes that aren't staged yet. */
export function commitsAll(command: string): boolean {
  return /\bgit\b[^;&|\n]*\bcommit\b[^;&|\n]*(\s-a\b|\s-[a-zA-Z]*a[a-zA-Z]*\b|\s--all\b)/.test(command);
}
