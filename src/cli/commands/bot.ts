import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { ROOT_BOT_ID } from '../../core/repositories/bot.repository.js';
import { currentProject, ensureInitialized } from '../context.js';

export function registerBot(program: Command) {
  const bot = program.command('bot').description('manage bots');
  bot
    .command('add <name>')
    .option('-r, --role <role>', 'role', 'custom')
    .option('--reports-to <id>', 'manager bot id', ROOT_BOT_ID)
    .action((name, opts) => {
      const project = currentProject();
      ensureInitialized(project);
      const b = project.bots.create({ name, role: opts.role, reportsTo: opts.reportsTo });
      console.log(`✔ ${PROJECT_DIR}/bots/${b.dir}/bot.md`);
    });
  bot.command('list').action(() => {
    for (const b of currentProject().bots.list()) {
      const skills = [...b.skills, ...b.localSkills.map((s) => `${s.name}*`)];
      console.log(`${b.avatar}  ${b.id.padEnd(14)} ${b.name} (${b.role})  skills: ${skills.join(', ') || '—'}`);
    }
  });
}
