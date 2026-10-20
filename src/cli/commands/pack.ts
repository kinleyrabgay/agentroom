import type { Command } from 'commander';
import { PackManager, findPack, listBuiltinPacks, suggestPacks } from '../../core/packs/packs.js';
import type { Project } from '../../core/project.js';
import { PROJECT_DIR } from '../../shared/constants.js';
import type { PackResult } from '../../shared/types/index.js';
import { currentProject, ensureInitialized } from '../context.js';

const ICON: Record<string, string> = { created: '+', updated: '~', merged: '~', removed: '-', conflict: '!', kept: '=', skipped: '·', unchanged: ' ' };

export function printPackResult(r: PackResult, verb: string) {
  console.log(`✔ ${verb} ${r.name} ${r.version}`);
  for (const c of r.changes.filter((c) => c.action !== 'unchanged')) console.log(`  ${ICON[c.action]} ${PROJECT_DIR}/${c.path}${c.note ? `  (${c.note})` : ''}`);
  if (r.settings.applied.length) console.log(`  settings: ${r.settings.applied.join(', ')}`);
  if (r.settings.kept.length) console.log(`  settings kept (you changed them): ${r.settings.kept.join(', ')}`);
  if (r.conflicts.length) console.log(`\n${r.conflicts.length} file(s) need you: compare each with its .pack-incoming copy, merge, then delete the copy.`);
}

/** Install a pack during init, and print a hint when the repo matches one. */
export function installPackOnInit(project: Project, pack: string | undefined) {
  if (pack) {
    printPackResult(new PackManager(project).apply(findPack(pack, project.root)), 'Installed pack');
    return;
  }
  const hits = suggestPacks(project.root);
  if (hits.length) {
    console.log('');
    for (const h of hits) console.log(`Tip: this looks like a ${h.pack.manifest.title} project (${h.reason}). Add its team: agentroom pack add ${h.pack.manifest.name}`);
  }
}

export function registerPack(program: Command) {
  const pack = program.command('pack').description('team packs: bots, skills, goal templates and settings for a stack');

  pack
    .command('list')
    .description('built-in packs, which fit this repo, and what is installed')
    .action(() => {
      const project = currentProject();
      const views = project.exists() ? new PackManager(project).list() : listBuiltinPacks().map((p) => ({ ...p.manifest, suggested: false, installed: undefined }));
      for (const p of views) {
        const tags = [p.installed ? `installed ${p.installed.version}${p.installed.modified ? `, ${p.installed.modified} edited` : ''}` : '', p.suggested ? 'fits this repo' : ''].filter(Boolean).join(' · ');
        console.log(`${p.name.padEnd(14)} ${p.version.padEnd(7)} ${p.title}${tags ? `  [${tags}]` : ''}`);
        console.log(`${' '.repeat(23)}${p.description}`);
      }
    });

  pack
    .command('add <name-or-folder>')
    .description('install a built-in pack or a pack folder')
    .action((name: string) => {
      const project = currentProject();
      ensureInitialized(project);
      printPackResult(new PackManager(project).apply(findPack(name, project.root)), 'Installed pack');
    });

  pack
    .command('update [name]')
    .description('update installed packs; your edits are merged, never overwritten')
    .action((name?: string) => {
      const manager = new PackManager(currentProject());
      const names = name ? [name] : Object.keys(manager.installed());
      if (!names.length) return console.log('No packs installed.');
      for (const n of names) printPackResult(manager.update(n), 'Updated');
    });

  pack
    .command('remove <name>')
    .description("remove a pack's files (files you edited stay)")
    .action((name: string) => printPackResult(new PackManager(currentProject()).remove(name), 'Removed'));
}
