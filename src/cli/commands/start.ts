import type { Command } from 'commander';
import open from 'open';
import { ProviderId } from '../../shared/enums.js';
import { startServer } from '../../server/index.js';
import { currentProject, ensureInitialized } from '../context.js';

export function registerStart(program: Command) {
  program
    .command('start')
    .description('start the AgentRoom UI for this project')
    .option('-p, --provider <name>', 'agent provider', ProviderId.Claude)
    .option('-m, --model <id>', 'default model for bots')
    .option('--port <n>', 'port (default from config)')
    .option('--no-open', 'do not open the browser')
    .action(async (opts) => {
      const project = currentProject();
      ensureInitialized(project);
      const port = Number(opts.port ?? project.config.get().port);
      try {
        const { url, close } = await startServer({ root: project.root, port, provider: opts.provider, model: opts.model });
        console.log(`\n  AgentRoom running for ${project.info().name}`);
        console.log(`  ${url}\n`);
        console.log('  The URL contains a session token — do not share it. Ctrl+C to stop.\n');
        if (opts.open) open(url).catch(() => {});
        const shutdown = async () => {
          await close();
          process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Try --port ${port + 1}`);
        else console.error(err?.message ?? err);
        process.exit(1);
      }
    });
}
