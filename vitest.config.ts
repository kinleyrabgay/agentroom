import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const web = (p: string) => fileURLToPath(new URL(`./web/${p}`, import.meta.url));

export default defineConfig({
  // The web app's aliases, so tests can cover its pure libs (transcript folding, tool sentences).
  resolve: {
    alias: [
      { find: /^@shared$/, replacement: web('lib/shared.ts') },
      { find: /^@\//, replacement: web('') },
    ],
  },
  test: {
    // Agent worktrees (Claude Code) hold full copies of the repo; never run their tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
