import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { currentProject, ensureInitialized } from '../context.js';

export function registerSkill(program: Command) {
  const skill = program.command('skill').description('manage skills');
  skill
    .command('add <name>')
    .option('-d, --description <text>', 'when the skill should be used', '')
    .option('-b, --bot <id>', "create it in a bot's own folder instead of the shared library")
    .action((name, opts) => {
      const project = currentProject();
      ensureInitialized(project);
      const input = { name, description: opts.description || `Describe when to use ${name}.`, body: `# ${name}\n\nWrite the instructions here.` };
      if (opts.bot) {
        const s = project.saveBotSkill(opts.bot, input);
        const bot = project.bots.get(opts.bot)!;
        console.log(`✔ ${PROJECT_DIR}/bots/${bot.dir}/skills/${s.name}/SKILL.md`);
      } else {
        const s = project.library.save(input);
        console.log(`✔ ${PROJECT_DIR}/skills/${s.name}/SKILL.md`);
      }
    });
  skill.command('list').action(() => {
    for (const s of currentProject().library.list()) console.log(`${s.name.padEnd(16)} ${s.description}`);
  });
}
