import type { Command } from 'commander';
import { ProviderId } from '../../shared/enums.js';
import { BACKGROUND_SUPPORTED, UNSUPPORTED_MESSAGE, backgroundStatus, installBackground, uninstallBackground } from '../../server/runner/background.js';
import { currentProject, ensureInitialized } from '../context.js';

/** `agentroom daemon install|uninstall|status`: keep AgentRoom running in the background (macOS). */
export function registerDaemon(program: Command) {
  const daemon = program.command('daemon').description('run AgentRoom in the background so schedules fire while the UI is closed (macOS)');

  const opts = (o: { port?: string; provider?: string }) => {
    const project = currentProject();
    ensureInitialized(project);
    const config = project.config.get();
    return {
      root: project.root,
      port: Number(o.port ?? config.port),
      provider: o.provider ?? config.provider ?? ProviderId.Claude,
      logFile: project.paths.daemonLog,
    };
  };
  const guard = () => {
    if (!BACKGROUND_SUPPORTED) {
      console.log(UNSUPPORTED_MESSAGE);
      process.exit(0);
    }
  };

  daemon
    .command('install')
    .description('start AgentRoom at login and keep it running')
    .option('--port <n>', 'port (default from config)')
    .option('-p, --provider <name>', 'agent provider')
    .action(async (o) => {
      guard();
      const st = await installBackground(opts(o));
      console.log(`Background mode is ${st.running ? 'running' : 'installed'} (${st.label}).`);
      console.log(`Open it any time with: agentroom start   ·   log: ${st.logFile}`);
    });

  daemon
    .command('uninstall')
    .description('stop and remove background mode')
    .action(async () => {
      guard();
      await uninstallBackground(opts({}));
      console.log('Background mode removed.');
    });

  daemon
    .command('status')
    .description('show whether background mode is installed and running')
    .action(async () => {
      guard();
      const st = await backgroundStatus(opts({}));
      console.log(`${st.label}: ${st.installed ? (st.running ? 'running' : 'installed, not running') : 'not installed'}`);
      console.log(`log: ${st.logFile}`);
    });
}
