import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { currentProject } from '../context.js';
import { proofAvailability } from '../../server/proof/browser.js';
import { providerStatuses } from '../../server/providers/status.js';
import { SecretsStore } from '../../server/services/secrets.store.js';

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
    .action(async () => {
      const major = Number(process.versions.node.split('.')[0]);
      console.log(`${major >= MIN_NODE ? '✔' : '✘'} node ${process.versions.node}`);
      check('git', 'git', ['--version']);
      check('git user', 'git', ['config', 'user.email']);
      check('git repo', 'git', ['rev-parse', '--show-toplevel']);
      check('gh auth', 'gh', ['auth', 'status', '--active']);
      check('claude CLI', 'claude', ['--version']);
      console.log(process.env.ANTHROPIC_API_KEY ? '✔ ANTHROPIC_API_KEY set' : '• ANTHROPIC_API_KEY not set (uses your Claude Code login instead)');
      const proof = await proofAvailability(process.cwd());
      console.log(proof.ok ? `✔ proof recording: headless ${proof.browser}` : `• proof recording off: ${proof.reason}`);
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
      // Other providers (experimental): installed, signed in?
      const engine = exists ? project.settings.get().engine : undefined;
      if (engine) {
        const keys = new Set(new SecretsStore(project.paths.secretsFile).providerKeys());
        for (const p of await providerStatuses({ engine, hasKey: (id) => keys.has(id) })) {
          if (p.id === 'claude') continue;
          const state = !p.available ? 'not available' : p.auth === 'missing' ? 'installed, not signed in' : `ready${p.version ? ` (${p.version})` : ''}`;
          console.log(`${p.available && p.auth !== 'missing' ? '✔' : '•'} ${p.name} (experimental): ${state}${p.hint ? `. ${p.hint}` : ''}`);
        }
      }
    });
}
