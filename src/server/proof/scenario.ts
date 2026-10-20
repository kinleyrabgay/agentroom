import type { ProofScenario, ProofStep } from '../../shared/types/index.js';

export const MAX_SCENARIOS = 3;
export const MAX_STEPS = 15;
const ACTIONS: ProofStep['action'][] = ['goto', 'click', 'fill', 'press', 'wait', 'expect', 'screenshot'];

/** The default when a bot gives no scenario: load the home page and take a picture. */
export function defaultScenarios(paths: string[] = ['/']): ProofScenario[] {
  return [{ name: 'Pages load', path: paths[0] ?? '/', steps: paths.slice(1, 4).map((p) => ({ action: 'goto' as const, target: p, label: p })) }];
}

/**
 * Pull scenarios out of a bot's reply: the last ```json block (or the whole text), either
 * `{ "scenarios": [...] }`, a list, or a single scenario. Invalid steps are dropped, not fatal.
 */
export function parseScenarios(text: string): ProofScenario[] {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [text];
  for (const raw of candidates) {
    let data: unknown;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { scenarios?: unknown }).scenarios) ? (data as { scenarios: unknown[] }).scenarios : [data];
    const out = list.map(cleanScenario).filter((s): s is ProofScenario => !!s);
    if (out.length) return out.slice(0, MAX_SCENARIOS);
  }
  return [];
}

/** Validate a scenario from a bot or the human. Returns null when nothing usable is left. */
export function cleanScenario(raw: unknown): ProofScenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const steps = (Array.isArray(r.steps) ? r.steps : []).map(cleanStep).filter((s): s is ProofStep => !!s).slice(0, MAX_STEPS);
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : 'Scenario';
  const path = typeof r.path === 'string' && r.path.trim() ? r.path.trim() : '/';
  if (!isAppPath(path)) return null;
  if (!steps.length && path === '/' && !r.steps) return null;
  return { name, path, steps };
}

function cleanStep(raw: unknown): ProofStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const action = String(r.action ?? '') as ProofStep['action'];
  if (!ACTIONS.includes(action)) return null;
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 300) : undefined);
  const step: ProofStep = { action };
  const target = str(r.target ?? r.selector ?? r.path ?? r.url ?? r.key);
  const value = str(r.value ?? r.text);
  const label = str(r.label);
  if (target !== undefined) step.target = target;
  if (value !== undefined) step.value = value;
  if (label !== undefined) step.label = label.slice(0, 80);
  if ((action === 'click' || action === 'fill' || action === 'press') && !step.target) return null;
  if (action === 'fill' && step.value === undefined) return null;
  if (action === 'expect' && !step.value && !step.target) return null;
  if (action === 'goto' && (!step.target || !isAppPath(step.target))) return null;
  return step;
}

/** Scenarios only browse the app itself: relative paths, or localhost URLs. */
export function isAppPath(p: string): boolean {
  if (p.startsWith('/') && !p.startsWith('//')) return true;
  try {
    const u = new URL(p);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Caption for the frame after a step. */
export function stepLabel(step: ProofStep): string {
  if (step.label) return step.label;
  switch (step.action) {
    case 'goto':
      return `Open ${step.target}`;
    case 'click':
      return `Click ${short(step.target)}`;
    case 'fill':
      return `Type in ${short(step.target)}`;
    case 'press':
      return `Press ${step.target}`;
    case 'wait':
      return step.value && !/^\d+$/.test(step.value) ? `Wait for "${short(step.value)}"` : 'Wait';
    case 'expect':
      return `Shows "${short(step.value ?? step.target)}"`;
    default:
      return 'Screenshot';
  }
}

const short = (s?: string) => (!s ? '' : s.length > 40 ? s.slice(0, 39) + '…' : s.replace(/^text=/, ''));
