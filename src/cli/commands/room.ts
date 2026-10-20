import type { Command } from 'commander';
import path from 'node:path';
import { Project } from '../../core/project.js';
import { sharingMode } from '../../core/sharing.js';
import { addRepos, createRoom, deleteRoom, listRooms, loadRoom, prepareMember, primaryOf, removeRepo, roomFile, setPrimary, type RoomConfig } from '../../core/rooms/index.js';
import { buildContextGraph } from './context.js';

function show(room: RoomConfig) {
  const primary = primaryOf(room);
  console.log(`\n  Room ${room.name}  (${roomFile(room.name)})`);
  for (const r of room.repos) console.log(`  ${r.id === primary.id ? '●' : '○'} ${r.id.padEnd(16)} ${r.path}${r.id === primary.id ? '   primary: team, board, settings' : ''}`);
  console.log(`\n  Start it with: agentroom start --room ${room.name}\n`);
}

/** Map each repo (facts only, seconds, no model calls) so the room map and cross-repo edges show up. */
function mapRepos(room: RoomConfig) {
  for (const r of room.repos) {
    try {
      const out = buildContextGraph(new Project(r.path));
      console.log(`  ✔ ${r.id}: ${out.files} files, ${out.modules} modules`);
    } catch (err) {
      console.log(`  ! ${r.id}: couldn't map it (${(err as Error).message})`);
    }
  }
}

/** Every repo that isn't primary gets a gitignored `.agentroom/runs/` (no bots or settings copied there). */
function prepare(room: RoomConfig) {
  const primary = primaryOf(room);
  for (const r of room.repos) if (r.id !== primary.id) prepareMember(r.path, (root) => sharingMode(root) === 'private');
}

/** `agentroom room …`: several repos worked on as one (frontend + backend). */
export function registerRoom(program: Command) {
  const room = program.command('room').description('work on several repos as one room (one team, one board, one map)');

  room
    .command('create <name> <paths...>')
    .description('create a room from repo folders (the first is primary unless --primary)')
    .option('--primary <repo>', 'repo id or folder that hosts the team and board')
    .option('--no-map', "don't map the repos now")
    .action((name: string, paths: string[], opts: { primary?: string; map: boolean }) => {
      const r = createRoom(name, paths, opts.primary ? { primary: opts.primary } : {});
      prepare(r);
      show(r);
      if (opts.map) mapRepos(r);
    });

  room
    .command('add <name> <paths...>')
    .description('add repo folders to a room')
    .action((name: string, paths: string[]) => {
      const r = addRepos(name, paths);
      prepare(r);
      show(r);
    });

  room
    .command('remove <name> <repo>')
    .description('remove a repo (id or folder) from a room; its files are not touched')
    .action((name: string, repo: string) => {
      const before = primaryOf(loadRoom(name));
      const r = removeRepo(name, repo);
      const after = primaryOf(r);
      if (before.id !== after.id) console.log(`  Note: ${after.id} is the primary repo now; the team and board come from ${path.join(after.path, '.agentroom')}.`);
      show(r);
    });

  room
    .command('primary <name> <repo>')
    .description('choose which repo hosts the team, board and settings')
    .action((name: string, repo: string) => show(setPrimary(name, repo)));

  room
    .command('list')
    .description('list rooms')
    .action(() => {
      const rooms = listRooms();
      if (!rooms.length) return console.log('\n  No rooms yet. Create one: agentroom room create <name> <path...>\n');
      console.log('');
      for (const r of rooms) console.log(`  ${r.name.padEnd(20)} ${r.repos.map((x) => x.id).join(', ')}`);
      console.log('');
    });

  room
    .command('show <name>')
    .description("show a room's repos")
    .action((name: string) => show(loadRoom(name)));

  room
    .command('map <name>')
    .description("map every repo of a room now (facts only)")
    .action((name: string) => mapRepos(loadRoom(name)));

  room
    .command('delete <name>')
    .description('delete a room (repos and their .agentroom/ folders stay)')
    .action((name: string) => {
      deleteRoom(name);
      console.log(`  Deleted room ${name}. The repos are untouched.`);
    });
}
