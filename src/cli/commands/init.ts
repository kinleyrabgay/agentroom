import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { currentProject } from '../context.js';
import { buildContextGraph } from './context.js';
import { installPackOnInit } from './pack.js';

export function registerInit(program: Command) {
  program
    .command('init')
    .description(`scaffold ${PROJECT_DIR}/ with a default team and starter skills`)
    .option('--private', `keep ${PROJECT_DIR}/ out of git for you only (.git/info/exclude), instead of sharing it with the team`)
    .option('--pack <name>', 'also install a team pack for your stack (agentroom pack list)')
    .action((opts: { private?: boolean; pack?: string }) => {
      const project = currentProject();
      const created = project.init({ private: opts.private });
      if (!created.length) {
        if (opts.private && project.makePrivate()) console.log(`✔ ${PROJECT_DIR}/ is now private (excluded for you only).`);
        else if (!opts.pack) console.log(`${PROJECT_DIR}/ already set up — nothing to add.`);
        if (opts.pack) installPackOnInit(project, opts.pack);
        return;
      }
      console.log(`✔ Initialized ${PROJECT_DIR}/${project.sharing() === 'private' ? ' (private: only on this machine)' : ''}`);
      for (const f of created) console.log(`  + ${f}`);
      console.log(
        project.sharing() === 'private'
          ? '\nPrivate: nothing here is committed. Run `agentroom share` to share bots, skills and settings with your team.'
          : `\nShared: commit ${PROJECT_DIR}/ so your team gets the same bots, skills and settings (runs/ stays local).`,
      );
      try {
        installPackOnInit(project, opts.pack);
      } catch (err) {
        console.log(`\n• Pack not installed: ${(err as Error).message}`);
      }
      try {
        const r = buildContextGraph(project);
        console.log(`\n✔ Repo map: ${r.files} files in ${r.modules} modules (INDEX.md ≈ ${r.tokens} tokens)`);
        console.log('  Module cards make bots faster and cheaper: agentroom context build (about two cents per module)');
      } catch (err) {
        console.log(`\n• Couldn't index the repo yet: ${(err as Error).message}`);
      }
      console.log('\nNext: agentroom start');
    });

  program
    .command('share')
    .description(`share ${PROJECT_DIR}/ with your team: stop excluding it, keep only runs/ out of git`)
    .action(() => {
      const project = currentProject();
      if (!project.exists()) return console.log(`No ${PROJECT_DIR}/ here yet. Run agentroom init first.`);
      project.share();
      console.log(`✔ ${PROJECT_DIR}/ is shared. Commit it so teammates get the same bots, skills and settings; ${PROJECT_DIR}/runs/ stays local.`);
    });
}
