import type { Command } from 'commander';
import path from 'node:path';
import { Project } from '../../core/project.js';
import { sharingMode } from '../../core/sharing.js';
import { addRepos, createWorkspace, deleteWorkspace, listWorkspaces, loadWorkspace, prepareMember, primaryOf, removeRepo, workspaceFile, setPrimary, type WorkspaceConfig } from '../../core/workspaces/index.js';
import { buildContextGraph } from './context.js';

function show(workspace: WorkspaceConfig) {
  const primary = primaryOf(workspace);
  console.log(`\n  Workspace ${workspace.name}  (${workspaceFile(workspace.name)})`);
  for (const r of workspace.repos) console.log(`  ${r.id === primary.id ? '●' : '○'} ${r.id.padEnd(16)} ${r.path}${r.id === primary.id ? '   primary: team, board, settings' : ''}`);
  console.log(`\n  Start it with: agentroom start --workspace ${workspace.name}\n`);
}

/** Map each repo (facts only, seconds, no model calls) so the workspace map and cross-repo edges show up. */
function mapRepos(workspace: WorkspaceConfig) {
  for (const r of workspace.repos) {
    try {
      const out = buildContextGraph(new Project(r.path));
      console.log(`  ✔ ${r.id}: ${out.files} files, ${out.modules} modules`);
    } catch (err) {
      console.log(`  ! ${r.id}: couldn't map it (${(err as Error).message})`);
    }
  }
}

/** Every repo that isn't primary gets a gitignored `.agentroom/runs/` (no bots or settings copied there). */
function prepare(workspace: WorkspaceConfig) {
  const primary = primaryOf(workspace);
  for (const r of workspace.repos) if (r.id !== primary.id) prepareMember(r.path, (root) => sharingMode(root) === 'private');
}

/** `agentroom workspace …`: several repos worked on as one (frontend + backend). */
export function registerWorkspace(program: Command) {
  const workspace = program.command('workspace').description('work on several repos as one workspace (one team, one board, one map)');

  workspace
    .command('create <name> <paths...>')
    .description('create a workspace from repo folders (the first is primary unless --primary)')
    .option('--primary <repo>', 'repo id or folder that hosts the team and board')
    .option('--no-map', "don't map the repos now")
    .action((name: string, paths: string[], opts: { primary?: string; map: boolean }) => {
      const r = createWorkspace(name, paths, opts.primary ? { primary: opts.primary } : {});
      prepare(r);
      show(r);
      if (opts.map) mapRepos(r);
    });

  workspace
    .command('add <name> <paths...>')
    .description('add repo folders to a workspace')
    .action((name: string, paths: string[]) => {
      const r = addRepos(name, paths);
      prepare(r);
      show(r);
    });

  workspace
    .command('remove <name> <repo>')
    .description('remove a repo (id or folder) from a workspace; its files are not touched')
    .action((name: string, repo: string) => {
      const before = primaryOf(loadWorkspace(name));
      const r = removeRepo(name, repo);
      const after = primaryOf(r);
      if (before.id !== after.id) console.log(`  Note: ${after.id} is the primary repo now; the team and board come from ${path.join(after.path, '.agentroom')}.`);
      show(r);
    });

  workspace
    .command('primary <name> <repo>')
    .description('choose which repo hosts the team, board and settings')
    .action((name: string, repo: string) => show(setPrimary(name, repo)));

  workspace
    .command('list')
    .description('list workspaces')
    .action(() => {
      const workspaces = listWorkspaces();
      if (!workspaces.length) return console.log('\n  No workspaces yet. Create one: agentroom workspace create <name> <path...>\n');
      console.log('');
      for (const r of workspaces) console.log(`  ${r.name.padEnd(20)} ${r.repos.map((x) => x.id).join(', ')}`);
      console.log('');
    });

  workspace
    .command('show <name>')
    .description("show a workspace's repos")
    .action((name: string) => show(loadWorkspace(name)));

  workspace
    .command('map <name>')
    .description("map every repo of a workspace now (facts only)")
    .action((name: string) => mapRepos(loadWorkspace(name)));

  workspace
    .command('delete <name>')
    .description('delete a workspace (repos and their .agentroom/ folders stay)')
    .action((name: string) => {
      deleteWorkspace(name);
      console.log(`  Deleted workspace ${name}. The repos are untouched.`);
    });
}
