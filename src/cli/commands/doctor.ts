import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { currentProject } from '../context.js';

const MIN_NODE = 20;

function check(label: string, cmd: string, args: string[]) {
  try {
    const out = execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split('\n')[0];
    console.log(`✔ ${label}: ${out}`);
  } catch {
    console.log(`✘ ${label}: not available`);
  }
}

export function registerDoctor(program: Command) {
  program
    .command('doctor')
    .description('check that agents can work in this project')
    .action(() => {
      const major = Number(process.versions.node.split('.')[0]);
      console.log(`${major >= MIN_NODE ? '✔' : '✘'} node ${process.versions.node}`);
      check('git', 'git', ['--version']);
      check('git user', 'git', ['config', 'user.email']);
      check('git repo', 'git', ['rev-parse', '--show-toplevel']);
      check('gh auth', 'gh', ['auth', 'status', '--active']);
      check('claude CLI', 'claude', ['--version']);
      console.log(process.env.ANTHROPIC_API_KEY ? '✔ ANTHROPIC_API_KEY set' : '• ANTHROPIC_API_KEY not set (uses your Claude Code login instead)');
      const project = currentProject();
      const exists = project.exists();
      console.log(`${exists ? '✔' : '•'} ${PROJECT_DIR}/ ${exists ? 'present' : 'missing — run agentroom init'}`);
      if (exists) {
        console.log(
          project.sharing() === 'private'
            ? `• Private: ${PROJECT_DIR}/ is excluded for you only (run agentroom share to share it)`
            : `✔ Shared: ${PROJECT_DIR}/ is meant to be committed; ${PROJECT_DIR}/runs/ is ignored`,
        );
      }
    });
}
