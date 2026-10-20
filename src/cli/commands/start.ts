import type { Command } from 'commander';
import open from 'open';
import { ProviderId } from '../../shared/enums.js';
import { startServer } from '../../server/index.js';
import { currentProject, ensureInitialized } from '../context.js';
import { liveSession } from '../../server/runner/background.js';
import { Project } from '../../core/project.js';
import { sharingMode } from '../../core/sharing.js';
import { loadRoom, prepareMember, primaryOf } from '../../core/rooms/index.js';

export function registerStart(program: Command) {
  program
    .command('start')
    .description('start the AgentRoom UI for this project')
    .option('-p, --provider <name>', 'agent provider', ProviderId.Claude)
    .option('-m, --model <id>', 'default model for bots')
    .option('--port <n>', 'port (default from config)')
    .option('--no-open', 'do not open the browser')
    .option('--private', 'when setting up, keep .agentroom/ out of git for you only')
    .option('--room <name>', 'open a multi-repo room (see `agentroom room`) instead of this folder')
    .action(async (opts) => {
      // A room runs from its primary repo; the other repos get a gitignored .agentroom/runs/ for their maps.
      const room = opts.room ? loadRoom(String(opts.room)) : null;
      const project = room ? new Project(primaryOf(room).path) : currentProject();
      ensureInitialized(project, { private: opts.private });
      if (room) for (const r of room.repos) if (r.path !== project.root) prepareMember(r.path, (root) => sharingMode(root) === 'private');
      const port = Number(opts.port ?? project.config.get().port);
      // Already running for this repo (e.g. background mode)? Open that instead of starting another.
      const live = await liveSession(project.paths.sessionFile);
      if (live && (!opts.port || live.port === port)) {
        console.log(`\n  AgentRoom is already running for ${project.info().name}${room ? ' (stop it to open the room)' : ''}`);
        console.log(`  ${live.url}\n`);
        if (opts.open) await open(live.url).catch(() => {});
        process.exit(0);
      }
      try {
        const { url, close } = await startServer({ root: project.root, port, provider: opts.provider, model: opts.model, ...(room ? { room: room.name } : {}) });
        console.log(`\n  AgentRoom running for ${room ? `room ${room.name} (${room.repos.map((r) => r.id).join(', ')})` : project.info().name}`);
        if (process.env.AGENTROOM_DAEMON === '1') {
          // Background mode writes stdout to a log file: never put the session token there.
          // `agentroom start` (or `agentroom open`) reads it from runs/session.json instead.
          console.log(`  ${url.split('?')[0]}  (background mode; run \`agentroom start\` to open it)\n`);
        } else {
          console.log(`  ${url}\n`);
          console.log('  The URL contains a session token — do not share it. Ctrl+C to stop.\n');
        }
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
