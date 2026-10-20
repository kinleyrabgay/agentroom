import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import type { SkillPreview } from '../../shared/types/index.js';
import { packSkill, validateSkill } from '../../server/registry/bundle.js';
import { RegistryService } from '../../server/registry/registry.service.js';
import { currentProject, ensureInitialized } from '../context.js';

/** Show everything that would be installed: the full SKILL.md, every file, scripts and warnings. */
function printPreview(p: SkillPreview, full: boolean) {
  console.log(`\n${p.name} ${p.version}  ·  ${p.source}`);
  console.log(`sha256 ${p.sha256}${p.verified ? '  ✔ matches the registry index' : ''}`);
  if (p.description) console.log(p.description);
  console.log(`\n──── SKILL.md ────\n${p.skillMd.trim()}\n──────────────────`);
  for (const f of p.files.filter((f) => f.path !== 'SKILL.md')) {
    console.log(`\n${f.executable ? '⚠ script ' : ''}${f.path} (${f.size} bytes)`);
    if (f.text !== undefined && (full || f.executable)) console.log(f.text.trimEnd());
  }
  for (const w of p.warnings) console.log(`\n⚠ ${w.label}: ${w.excerpt}`);
  if (p.exists) console.log(`\n⚠ A skill named ${p.name} already exists${p.exists.modified ? ' and has local edits' : ''}; installing replaces it.`);
  console.log('\nNothing in this skill is run on install.');
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function reviewAndInstall(registry: RegistryService, preview: SkillPreview, yes: boolean, full: boolean) {
  printPreview(preview, full);
  if (!yes && !(await confirm(`Install ${preview.name} into ${PROJECT_DIR}/skills/?`))) return console.log('Not installed.');
  const r = registry.install(preview.id, { overwrite: !!preview.exists });
  console.log(`✔ ${PROJECT_DIR}/skills/${r.name}/ (source: ${r.source}). Assign it to a bot in the UI or with the bot's skills list.`);
}

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
  skill
    .command('install <ref>')
    .description('install a skill after showing it in full: skills-sh:<owner>/<repo>/<skill>, github:<owner>/<repo>[/<skill>], index:<registry>/<name>, an https URL to a .tgz/.zip (#sha256=…), or a local folder/SKILL.md/.zip')
    .option('-y, --yes', "install without asking (you've already read it)")
    .option('--full', 'print every text file, not just SKILL.md and scripts')
    .action(async (ref: string, opts: { yes?: boolean; full?: boolean }) => {
      const project = currentProject();
      ensureInitialized(project);
      const registry = new RegistryService(project);
      const local = !/^(skills-sh|github|index):|^https?:\/\//.test(ref) && fs.existsSync(path.resolve(ref));
      const preview = local ? registry.previewLocal(ref) : await registry.preview(ref);
      await reviewAndInstall(registry, preview, !!opts.yes, !!opts.full);
    });

  skill
    .command('update <name>')
    .description('fetch the latest copy of an installed skill, show it, and replace yours if you agree')
    .option('-y, --yes', 'replace without asking')
    .action(async (name: string, opts: { yes?: boolean }) => {
      const registry = new RegistryService(currentProject());
      const { preview, changed } = await registry.checkUpdate(name);
      if (!changed) return console.log(`${name} is up to date.`);
      await reviewAndInstall(registry, preview, !!opts.yes, false);
    });

  skill
    .command('validate <name-or-folder>')
    .description('check a skill against the SKILL.md format before sharing it')
    .action((target: string) => {
      const project = currentProject();
      const dir = fs.existsSync(path.resolve(target)) ? path.resolve(target) : path.join(project.paths.skills, target);
      const r = validateSkill(dir);
      for (const e of r.errors) console.log(`✖ ${e}`);
      for (const w of r.warnings) console.log(`⚠ ${w}`);
      console.log(r.ok ? `✔ ${path.basename(dir)} is ready to publish` : '');
      if (!r.ok) process.exitCode = 1;
    });

  skill
    .command('publish <name-or-folder>')
    .description('pack a skill for a registry: writes <name>-<version>.tgz and its index entry (nothing is uploaded)')
    .option('-r, --release <version>', "version to publish (default: the skill's own, or 0.1.0)")
    .option('-o, --out <dir>', 'output folder', 'dist-skills')
    .option('--base-url <url>', 'where the tarball will be hosted (for the index entry)')
    .option('--author <name>', 'author shown in the registry')
    .action((target: string, opts: { release?: string; out: string; baseUrl?: string; author?: string }) => {
      const project = currentProject();
      const dir = fs.existsSync(path.resolve(target)) ? path.resolve(target) : path.join(project.paths.skills, target);
      const out = packSkill(dir, path.resolve(opts.out), { ...(opts.release ? { version: opts.release } : {}), ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}), ...(opts.author ? { author: opts.author } : {}) });
      console.log(`✔ ${path.relative(process.cwd(), out.tarball)}\n✔ ${path.relative(process.cwd(), out.entryFile)}`);
      console.log('\nTo publish: host the .tgz, add the entry to your registry index.json (its "skills" list), and commit.');
      console.log('Others install it with: agentroom skill install index:<registry>/' + String(out.entry.name));
      console.log('Marketplaces that take SKILL.md uploads (skills.sh via a GitHub repo, Agensi and others) accept the folder as is.');
    });

  skill.command('list').action(() => {
    for (const s of currentProject().library.list()) console.log(`${s.name.padEnd(16)} ${s.description}`);
  });
}
