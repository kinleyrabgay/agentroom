import type { AutopilotConfidence, AutopilotFactor, GoalAutopilot, ProofSummary } from '../../shared/types/index.js';

export interface ConfidenceInput {
  reproduced?: boolean;
  verification?: GoalAutopilot['verification'];
  /** Modules the fix touches or affects (context map impact), or null when unknown. */
  impactModules: number | null;
  /** Risk score of the diff (0–100), or null when unknown. */
  riskScore: number | null;
  proof?: ProofSummary;
}

/**
 * How sure we are the fix is right, 0–100, from evidence AgentRoom measured itself:
 * reproduced, the test fails before and passes after, a small blast radius, low risk, checks passing.
 * Unknowns score 0 (conservative). A test that doesn't pass, or a bug that wasn't reproduced, caps the score.
 */
export function confidenceOf(input: ConfidenceInput, now = new Date()): AutopilotConfidence {
  const v = input.verification;
  const factors: AutopilotFactor[] = [
    factor('Reproduced', 20, input.reproduced ?? null, input.reproduced === undefined ? 'Not reported yet' : undefined),
    factor('Test fails before the fix', 25, v ? v.failsOnBase : null, v?.failsOnBase === null ? "Couldn't run on the starting commit" : !v ? 'No test reported' : undefined),
    factor('Test passes after the fix', 25, v ? v.passesOnHead : null, v?.passesOnHead === null ? "Couldn't run on the fix" : !v ? 'No test reported' : undefined),
    blastRadius(input.impactModules),
    risk(input.riskScore),
    checks(input.proof),
  ];
  let score = factors.reduce((n, f) => n + f.points, 0);
  if (v?.passesOnHead === false) score = Math.min(score, 30);
  if (input.reproduced === false) score = Math.min(score, 10);
  return { score: Math.round(score), at: now.toISOString(), factors };
}

function factor(label: string, max: number, ok: boolean | null, detail?: string): AutopilotFactor {
  return { label, max, points: ok ? max : 0, ok, ...(detail ? { detail } : {}) };
}

function blastRadius(modules: number | null): AutopilotFactor {
  const max = 15;
  if (modules === null) return { label: 'Small blast radius', max, points: 0, ok: null, detail: 'Context map unavailable' };
  const points = modules <= 1 ? 15 : modules <= 3 ? 10 : modules <= 6 ? 5 : 0;
  return { label: 'Small blast radius', max, points, ok: points >= 10, detail: `${modules} ${modules === 1 ? 'module' : 'modules'} affected` };
}

function risk(score: number | null): AutopilotFactor {
  const max = 10;
  if (score === null) return { label: 'Low risk', max, points: 0, ok: null, detail: 'Risk not computed' };
  const points = Math.round(max * (1 - Math.min(100, Math.max(0, score)) / 100));
  return { label: 'Low risk', max, points, ok: score < 40, detail: `Risk score ${score}` };
}

function checks(proof: ProofSummary | undefined): AutopilotFactor {
  const max = 5;
  if (!proof || proof.status === 'skipped') return { label: 'Checks pass', max, points: 3, ok: null, detail: proof ? 'No UI to verify' : 'Not verified in a browser' };
  const ok = proof.status === 'passed' && !proof.failing.length;
  return { label: 'Checks pass', max, points: ok ? max : 0, ok, detail: ok ? proof.summary : proof.failing.join(', ') || proof.summary };
}

/** Whether autopilot may open the PR on its own. */
export function mayAutoOpen(a: GoalAutopilot, settings: { allowAutoPr: boolean; minConfidence: number }): { ok: boolean; why: string } {
  if (!a.autoPr) return { ok: false, why: 'This trigger stops for you before the PR.' };
  if (!settings.allowAutoPr) return { ok: false, why: 'Auto-PR is off in Settings → Autopilot.' };
  const score = a.confidence?.score ?? 0;
  if (score < settings.minConfidence) return { ok: false, why: `Confidence ${score} is below ${settings.minConfidence}.` };
  if (a.verification?.failsOnBase !== true || a.verification?.passesOnHead !== true) return { ok: false, why: "The failing test wasn't verified before and after the fix." };
  return { ok: true, why: `Confidence ${score} ≥ ${settings.minConfidence}.` };
}
