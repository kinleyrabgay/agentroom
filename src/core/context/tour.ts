import { parseCitation, symbolLine } from './cards.js';
import { derivedPurpose } from './index-md.js';
import type { ContextGraph, ModuleCard, ModuleNode } from './types.js';

export type TourStage = 'start' | 'core' | 'features' | 'edges';

export interface TourStep {
  moduleId: string;
  dir: string;
  stage: TourStage;
  why: string;
  purpose: string;
  keyFiles: { path: string; line?: number; note: string }[];
  tryAsk: string;
  hasCard: boolean;
}

const MAX_START = 4;
const MAX_CORE = 6;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fanIn = (m: ModuleNode) => Object.keys(m.dependents).length;
const fanOut = (m: ModuleNode) => Object.keys(m.deps).length;
const label = (m: ModuleNode) => (m.dir ? m.dir : 'the repo root');

function isCode(m: ModuleNode, g: ContextGraph): boolean {
  return m.files.some((f) => {
    const n = g.files[f]!;
    return !n.isTest && n.lang !== 'other';
  });
}

/**
 * An onboarding path through the modules: entry points first (what runs), then the core everything
 * leans on, then features in the order you'd reach them from the entry points, then tests and assets.
 */
export function buildTour(graph: ContextGraph, cards: Record<string, ModuleCard | null>): TourStep[] {
  const all = Object.values(graph.modules);
  const code = all.filter((m) => isCode(m, graph));
  const used = new Set<string>();
  const steps: TourStep[] = [];
  const add = (m: ModuleNode, stage: TourStage, why: string) => {
    used.add(m.id);
    steps.push(step(m, stage, why, graph, cards[m.id] ?? null));
  };

  const starts = code
    .filter((m) => !fanIn(m) && fanOut(m))
    .sort((a, b) => fanOut(b) - fanOut(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_START);
  for (const m of starts) add(m, 'start', `Entry point: imports ${plural(fanOut(m), 'module')}, nothing imports it`);

  const core = code
    .filter((m) => !used.has(m.id) && fanIn(m) >= 3)
    .sort((a, b) => fanIn(b) - fanIn(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_CORE);
  for (const m of core) add(m, 'core', `Used by ${plural(fanIn(m), 'module')}`);

  // Features: breadth-first from the entry points along imports.
  const depth = new Map<string, { d: number; from: string }>();
  const queue = starts.map((m) => ({ id: m.id, d: 0, from: m.id }));
  for (const q of queue) depth.set(q.id, { d: 0, from: q.from });
  while (queue.length) {
    const { id, d, from } = queue.shift()!;
    for (const dep of Object.keys(graph.modules[id]?.deps ?? {}).sort()) {
      if (depth.has(dep)) continue;
      depth.set(dep, { d: d + 1, from });
      queue.push({ id: dep, d: d + 1, from });
    }
  }
  const features = code
    .filter((m) => !used.has(m.id))
    .sort((a, b) => (depth.get(a.id)?.d ?? 99) - (depth.get(b.id)?.d ?? 99) || fanIn(b) - fanIn(a) || a.id.localeCompare(b.id));
  for (const m of features) {
    const at = depth.get(m.id);
    const parts = [at && at.d > 0 ? `${plural(at.d, 'step')} from ${at.from}` : 'Not reached from an entry point', fanIn(m) ? `used by ${plural(fanIn(m), 'module')}` : ''];
    add(m, 'features', parts.filter(Boolean).join(' · '));
  }

  for (const m of all.filter((x) => !used.has(x.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    const tests = m.files.filter((f) => graph.files[f]!.isTest).length;
    add(m, 'edges', tests ? `Tests (${plural(tests, 'file')})` : 'Docs, config and assets');
  }
  return steps;
}

function step(m: ModuleNode, stage: TourStage, why: string, g: ContextGraph, card: ModuleCard | null): TourStep {
  const keyFiles: TourStep['keyFiles'] = [];
  const seen = new Set<string>();
  for (const c of card?.entryPoints ?? []) {
    const p = c.cite[0] ? parseCitation(c.cite[0]) : null;
    if (!p || !g.files[p.file] || seen.has(p.file)) continue;
    const line = p.symbol ? (symbolLine(g, p.file, p.symbol) ?? undefined) : p.line;
    keyFiles.push({ path: p.file, ...(line ? { line } : {}), note: c.text });
    seen.add(p.file);
    if (keyFiles.length >= 3) break;
  }
  if (keyFiles.length < 3) {
    const ranked = m.files
      .filter((f) => !seen.has(f) && !g.files[f]!.isTest)
      .map((f) => {
        const syms = g.files[f]!.symbols.filter((s) => s.exported && s.kind !== 'method');
        const outside = m.surface.filter((s) => s.split('#')[0] === f).length;
        return { f, syms, score: outside * 3 + syms.length + syms.filter((s) => s.kind === 'route').length * 2 };
      })
      .sort((a, b) => b.score - a.score || a.f.localeCompare(b.f));
    for (const r of ranked.slice(0, 3 - keyFiles.length)) {
      const names = r.syms.slice(0, 4).map((s) => s.name);
      keyFiles.push({ path: r.f, ...(r.syms[0] ? { line: r.syms[0].line } : {}), note: names.length ? `Exports ${names.join(', ')}${r.syms.length > 4 ? ` +${r.syms.length - 4}` : ''}` : `${g.files[r.f]!.lines} lines` });
    }
  }
  const tryAsk =
    stage === 'start'
      ? `What happens when ${label(m)} starts, step by step?`
      : stage === 'core'
        ? `What rules must I not break when changing ${label(m)}?`
        : stage === 'features'
          ? `How does ${label(m)} work, and where would I add to it?`
          : `What's in ${label(m)} and when is it used?`;
  return { moduleId: m.id, dir: m.dir, stage, why, purpose: card?.purpose?.trim() || derivedPurpose(m, g), keyFiles, tryAsk, hasCard: !!card?.generatedAt };
}
