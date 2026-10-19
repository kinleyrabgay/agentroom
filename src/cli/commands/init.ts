import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { currentProject } from '../context.js';

export function registerInit(program: Command) {
  program
    .command('init')
    .description(`scaffold ${PROJECT_DIR}/ with a default team and starter skills`)
    .action(() => {
      const created = currentProject().init();
      if (!created.length) return console.log(`${PROJECT_DIR}/ already set up — nothing to add.`);
      console.log(`✔ Initialized ${PROJECT_DIR}/`);
      for (const f of created) console.log(`  + ${f}`);
      console.log('\nNext: agentroom start --provider claude');
    });
}
