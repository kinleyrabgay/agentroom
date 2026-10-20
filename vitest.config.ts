import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Agent worktrees (Claude Code) hold full copies of the repo; never run their tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
