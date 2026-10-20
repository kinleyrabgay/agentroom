import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { PROJECT_DIR } from '../../shared/constants.js';
import { buildGraph, contextPaths, exportContextBlock, saveGraph, writeIndex, loadCard } from '../../core/context/index.js';
import { ContextService } from '../../server/context/context.service.js';
import { LedgerService } from '../../server/services/ledger.service.js';
import type { Project } from '../../core/project.js';
import { currentProject, ensureInitialized } from '../context.js';

function service(project: Project) {
  const ledger = new LedgerService(project.paths.ledgerFile);
  return new ContextService({
    root: project.root,
    settings: () => project.settings.get(),
    record: (row) => ledger.record(row),
    dayRemaining: () => {
      const cap = project.settings.get().budgets.perDayUsd;
      return cap === null ? undefined : cap - ledger.spentToday();
    },
  });
}

/** Facts only: fast, no model calls. Used by `init` and `context build --no-cards`. */
export function buildContextGraph(project: Project): { files: number; modules: number; tokens: number } {
  const graph = buildGraph(project.root);
  saveGraph(project.root, graph);
  const purposes: Record<string, string> = {};
  for (const id of Object.keys(graph.modules)) {
    const p = loadCard(project.root, id)?.purpose;
    if (p) purposes[id] = p;
  }
  const { tokens } = writeIndex(project.root, graph, purposes);
  return { files: Object.keys(graph.files).length, modules: Object.keys(graph.modules).length, tokens };
}

async function runSync(project: Project, opts: { full?: boolean; cards?: boolean; only?: string[] }) {
  const ctx = service(project);
  let lastLine = '';
  const timer = setInterval(() => {
    const p = ctx.status().progress;
    const line = p ? `${p.message}${p.total ? ` (${p.done ?? 0}/${p.total})` : ''}` : '';
    if (line && line !== lastLine) {
      console.log(`  ${line}`);
      lastLine = line;
    }
  }, 400);
  try {
    const s = await ctx.sync({ full: opts.full, cards: opts.cards !== false, ...(opts.only?.length ? { only: opts.only } : {}) });
    const st = ctx.status();
    console.log(`✔ ${s.files} files · ${s.modules} modules · INDEX.md ≈ ${s.tokensIndex} tokens (${s.incremental ? 'incremental' : 'full'}, ${s.durationMs} ms)`);
    if (s.cardsRegenerated.length) console.log(`  cards written: ${s.cardsRegenerated.join(', ')}${st.last?.costUsd ? ` · $${st.last.costUsd.toFixed(4)}` : ''}`);
    if (s.cardsRefreshed.length) console.log(`  cards re-checked: ${s.cardsRefreshed.length}`);
    for (const f of s.cardsFailed) console.log(`✘ ${f.id}: ${f.error}`);
    if (s.missing.length) console.log(`• ${s.missing.length} modules without a card${opts.cards === false ? '' : ' (capped per sync; run again or raise settings.context.maxCardsPerSync)'}`);
    if (s.stale.length) console.log(`• stale cards: ${s.stale.join(', ')}`);
    if (s.citationsDropped) console.log(`• ${s.citationsDropped} unverifiable citations dropped`);
  } finally {
    clearInterval(timer);
  }
}

export function registerContext(program: Command) {
  const cmd = program.command('context').description('the repo map bots read: modules, cards and dependencies');

  cmd
    .command('build')
    .description('index the whole repo and write module cards')
    .option('--no-cards', 'facts and INDEX.md only (no model calls)')
    .option('--only <ids...>', 'write cards for these modules only')
    .action(async (opts: { cards: boolean; only?: string[] }) => {
      const project = currentProject();
      ensureInitialized(project);
      if (!opts.cards) {
        const r = buildContextGraph(project);
        console.log(`✔ ${r.files} files · ${r.modules} modules · INDEX.md ≈ ${r.tokens} tokens`);
        console.log('  Next: agentroom context build   (writes module cards, about two cents each)');
        return;
      }
      await runSync(project, { full: true, cards: true, only: opts.only });
    });

  cmd
    .command('sync')
    .description('update what changed since the last sync and rewrite out-of-date cards')
    .option('--no-cards', 'facts and INDEX.md only')
    .action(async (opts: { cards: boolean }) => {
      const project = currentProject();
      ensureInitialized(project);
      await runSync(project, { cards: opts.cards });
    });

  cmd
    .command('status')
    .description('what the map covers and which cards are out of date')
    .action(() => {
      const project = currentProject();
      const st = service(project).status();
      if (!st.built) return console.log('No repo context yet. Run: agentroom context build');
      console.log(`${st.enabled ? '✔' : '•'} context ${st.enabled ? 'on' : 'off (settings.context.enabled)'}`);
      console.log(`  ${st.files} files · ${st.modules} modules · indexed at ${st.indexedSha?.slice(0, 7) ?? '(no git)'} · ${st.indexedAt}`);
      console.log(`  cards: ${st.cards.fresh} fresh · ${st.cards.stale} stale · ${st.cards.missing} missing${st.cards.missing ? ` (≈ $${st.estimateUsd.toFixed(2)} to write)` : ''}`);
      console.log(`  INDEX.md ≈ ${st.tokensIndex} tokens (in every bot's instructions)`);
    });

  cmd
    .command('export')
    .description('copy the repo map into CLAUDE.md / AGENTS.md (between agentroom markers) for other agents')
    .option('--file <paths...>', 'files to write (default: CLAUDE.md, plus AGENTS.md when it exists)')
    .action((opts: { file?: string[] }) => {
      const project = currentProject();
      const index = contextPaths(project.root).index;
      if (!fs.existsSync(index)) return console.log(`No ${PROJECT_DIR}/context/INDEX.md yet. Run: agentroom context build --no-cards`);
      const text = fs.readFileSync(index, 'utf8');
      const targets = opts.file?.length ? opts.file : ['CLAUDE.md', ...(fs.existsSync(path.join(project.root, 'AGENTS.md')) ? ['AGENTS.md'] : [])];
      for (const t of targets) {
        const changed = exportContextBlock(path.resolve(project.root, t), text);
        console.log(`${changed ? '✔ updated' : '• unchanged'} ${t}`);
      }
    });
}
