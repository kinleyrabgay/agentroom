import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  // Keep runtime deps external; they are installed with the package.
  skipNodeModulesBundle: true,
});
