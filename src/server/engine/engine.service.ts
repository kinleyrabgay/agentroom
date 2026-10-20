import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProviderId, ToolName, WorkPhase } from '../../shared/enums.js';
import type { Bot, CostEstimate, EvalRun, ExperimentResult, ExperimentVariant, GoalOutcome, ProviderStatus, Suggestion } from '../../shared/types/index.js';
import type { Project } from '../../core/project.js';
import { readJson } from '../../core/fs/json.js';
import type { LedgerService } from '../services/ledger.service.js';
import { RunTally } from '../services/ledger.service.js';
import type { SecretsStore } from '../services/secrets.store.js';
import type { ProviderPool } from '../providers/registry.js';
import { planRoute } from '../providers/router.js';
import { providerStatuses } from '../providers/status.js';
import { createDetachedWorktree, removeWorktree } from '../git/goal-git.js';
import { planPrompt } from '../workflow/prompts.js';
import { resolveRoles } from '../workflow/roles.js';
import { applyVariant, experimentResult, ExperimentStore, type NewExperiment } from './experiments.js';
import { cliProbe, OutcomeTracker, type OutcomeProbe } from './outcomes.js';
import { estimateGoalCost, suggest } from './suggestions.js';

export interface EngineDeps {
  project: Project;
  ledger: LedgerService;
  secrets: SecretsStore;
  providers: ProviderPool;
  /** Where throwaway eval folders go (outside the repo). */
  scratchDir: string;
  probe?: OutcomeProbe;
}

/** Read-only tools for replay evals: the plan step only reads the code. */
const EVAL_TOOLS = [ToolName.Read, ToolName.Grep, ToolName.Glob];
const MAX_EVALS = 50;

/**
 * The engine's server side: provider status and keys, cost estimates, outcome tracking,
 * experiments, suggestions and replay evals.
 */
export class EngineService {
  readonly experiments: ExperimentStore;
  readonly outcomes: OutcomeTracker;
  private evals: EvalRun[];
  private readonly evalsFile: string;

  constructor(private readonly deps: EngineDeps) {
    const runs = deps.project.paths.runs;
    this.experiments = new ExperimentStore(path.join(runs, 'experiments.json'), () => deps.project.library.list().map((s) => s.name));
    this.outcomes = new OutcomeTracker(path.join(runs, 'outcomes.json'), deps.probe ?? cliProbe(deps.project.root));
    this.evalsFile = path.join(runs, 'evals.json');
    this.evals = readJson<EvalRun[]>(this.evalsFile, []).map((e) => (e.status === 'running' ? { ...e, status: 'failed' as const, error: 'Interrupted (AgentRoom restarted).' } : e));
  }

  private get settings() {
    return this.deps.project.settings.get();
  }

  // ---- providers ----

  providers(): Promise<ProviderStatus[]> {
    const keys = new Set(this.deps.secrets.providerKeys());
    return providerStatuses({ engine: this.settings.engine, hasKey: (id) => keys.has(id) });
  }

  setKey(provider: string, key: string) {
    if (provider === ProviderId.Claude) throw new Error('Claude uses your Claude Code login or ANTHROPIC_API_KEY.');
    if (!Object.values(ProviderId).includes(provider as ProviderId)) throw new Error(`Unknown provider "${provider}".`);
    this.deps.secrets.setProviderKey(provider, key);
  }

  estimate(): CostEstimate {
    const bots = this.deps.project.bots.list();
    const roles = resolveRoles(bots);
    const botFor = (phase: string): Bot | undefined =>
      'missing' in roles ? bots[0] : phase === WorkPhase.Planning ? roles.planner : phase === WorkPhase.Testing ? roles.qa : phase === WorkPhase.Reporting ? roles.lead : roles.developer;
    return estimateGoalCost({
      ledger: this.deps.ledger.list(),
      goals: this.deps.project.goals.list(),
      routeFor: (phase) => {
        const bot = botFor(phase);
        if (!bot) return { provider: this.deps.project.config.get().provider, model: this.deps.project.config.get().model };
        return planRoute({ bot, phase, settings: this.settings, config: this.deps.project.config.get() })[0]!;
      },
    });
  }

  // ---- outcomes + experiments ----

  async refreshOutcomes(): Promise<GoalOutcome[]> {
    return this.outcomes.refresh(this.deps.project.goals.list(), this.deps.ledger.list(), { remote: this.settings.engine.learning.trackOutcomes });
  }

  experimentResults(): ExperimentResult[] {
    const min = this.settings.engine.learning.minSamples;
    return this.experiments
      .list()
      .map((e) => experimentResult(e, (id) => this.outcomes.get(id), min))
      .sort((a, b) => (a.experiment.status === b.experiment.status ? b.experiment.createdAt.localeCompare(a.experiment.createdAt) : a.experiment.status === 'running' ? -1 : 1));
  }

  createExperiment(input: NewExperiment) {
    if (!this.deps.project.bots.get(input.botId)) throw new Error(`Unknown bot "${input.botId}".`);
    return this.experiments.create(input);
  }

  suggestions(): Suggestion[] {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return suggest({
      ledger: this.deps.ledger.list({ since }),
      bots: this.deps.project.bots.list(),
      skills: this.deps.project.library.list(),
      settings: this.settings,
      dismissed: this.experiments.dismissed(),
    });
  }

  /** Apply a suggestion (explicit click), or start an experiment that tests it. */
  applySuggestion(id: string, mode: 'apply' | 'experiment'): { applied: string } {
    const s = this.suggestions().find((x) => x.id === id);
    if (!s) throw new Error('That suggestion no longer applies.');
    if (s.kind === 'add-skill' && s.botId && s.skill) {
      const bot = this.deps.project.bots.get(s.botId);
      if (!bot) throw new Error(`Unknown bot "${s.botId}".`);
      if (mode === 'experiment') {
        const exp = this.experiments.create({ name: `${bot.name} + ${s.skill}`, botId: bot.id, change: { label: `+ ${s.skill}`, addSkills: [s.skill], removeSkills: [], promptAppend: '' } });
        this.experiments.dismiss(id);
        return { applied: `Started experiment "${exp.name}".` };
      }
      this.deps.project.bots.update(bot.id, { skills: [...new Set([...bot.skills, s.skill])] });
      this.experiments.dismiss(id);
      return { applied: `${bot.name} now has ${s.skill}.` };
    }
    if (s.kind === 'cheaper-model' && s.phase && s.model) {
      const models = this.deps.project.settings.team().models as Record<string, Record<string, unknown>>;
      this.deps.project.settings.update({ models: { ...models, [s.phase]: { ...(models[s.phase] ?? {}), model: s.model } } as never }, 'team');
      this.experiments.dismiss(id);
      return { applied: `${s.phase} now uses ${s.model}.` };
    }
    throw new Error('This suggestion can only be dismissed.');
  }

  dismissSuggestion(id: string) {
    this.experiments.dismiss(id);
  }

  // ---- replay evals ----

  listEvals(): EvalRun[] {
    return [...this.evals].reverse();
  }

  /**
   * Re-run a finished goal's plan step with a change (skill / instructions), read-only, in a throwaway
   * folder at the goal's starting commit, under a budget cap. The result sits next to the original plan.
   */
  startEval(input: { goalId: string; botId?: string; variant: Omit<ExperimentVariant, 'id'> }): EvalRun {
    const { project } = this.deps;
    const goal = project.goals.get(input.goalId);
    if (!goal) throw new Error('No such goal.');
    if (!goal.plan.trim()) throw new Error("That goal has no plan to compare with.");
    if (!goal.baseRef) throw new Error("That goal didn't record its starting commit.");
    if (this.evals.some((e) => e.status === 'running')) throw new Error('One replay at a time. Wait for the running one to finish.');
    const bots = project.bots.list();
    const roles = resolveRoles(bots);
    const bot = (input.botId ? project.bots.get(input.botId) : undefined) ?? ('missing' in roles ? undefined : roles.planner);
    if (!bot || 'missing' in roles) throw new Error('Replay needs a team with a Planner.');
    const variant: ExperimentVariant = { id: 'eval', label: input.variant.label || 'Change', addSkills: input.variant.addSkills ?? [], removeSkills: input.variant.removeSkills ?? [], promptAppend: (input.variant.promptAppend ?? '').trim() };
    const library = new Set(project.library.list().map((s) => s.name));
    const unknown = variant.addSkills.filter((s) => !library.has(s));
    if (unknown.length) throw new Error(`Unknown skill: ${unknown.join(', ')}`);
    const route = planRoute({ bot, phase: WorkPhase.Planning, settings: this.settings, config: project.config.get() })[0]!;
    const run: EvalRun = {
      id: randomUUID().slice(0, 8),
      goalId: goal.id,
      goalTitle: goal.title,
      botId: bot.id,
      variant,
      provider: route.provider,
      model: route.model,
      status: 'running',
      startedAt: new Date().toISOString(),
      original: goal.plan,
      output: '',
      costUsd: 0,
    };
    this.evals.push(run);
    this.evals = this.evals.slice(-MAX_EVALS);
    this.saveEvals();
    void this.execEval(run, bot, { ...roles, planner: bot }).catch(() => {});
    return run;
  }

  private async execEval(run: EvalRun, bot: Bot, roles: Parameters<typeof planPrompt>[1]) {
    const { project, ledger } = this.deps;
    const goal = project.goals.get(run.goalId)!;
    const dir = path.join(this.deps.scratchDir, run.id);
    const tally = new RunTally('eval', run.model, {});
    const budget = this.settings.engine.learning.evalBudgetUsd;
    const ac = new AbortController();
    try {
      await createDetachedWorktree(project.root, dir, goal.baseRef!);
      const changed = applyVariant({ ...bot, tools: bot.tools.filter((t) => EVAL_TOOLS.includes(t as (typeof EVAL_TOOLS)[number])) }, run.variant);
      const prompt = `${planPrompt({ ...goal, plan: '', feedback: undefined }, roles, [])}\n\n---\nThis is a dry run to compare plans: you have no task or plan tools. Do not change files. Reply with the plan overview and the task list as markdown.`;
      const res = await this.deps.providers.get(run.provider).run({
        bot: changed,
        prompt,
        cwd: dir,
        maxBudgetUsd: budget,
        model: run.model,
        skills: { libraryPluginDir: project.paths.dir, botPluginDir: project.paths.botDir(bot.dir) },
        context: '',
        hostTools: [],
        signal: ac.signal,
        emit: (e) => tally.observe(e),
        stream: () => {},
        // Read-only: anything that isn't a read is refused.
        askPermission: async (tool) => (EVAL_TOOLS.includes(tool as (typeof EVAL_TOOLS)[number]) ? { allow: true } : { allow: false, message: 'Replay evals are read-only.' }),
      });
      const row = ledger.record(tally.finish({ ok: res.ok, aborted: false, ...(res.ok ? {} : { error: res.result }), provider: run.provider }));
      Object.assign(run, { status: res.ok ? 'done' : 'failed', output: res.result, costUsd: row.costUsd, finishedAt: new Date().toISOString(), ...(res.ok ? {} : { error: res.result.split('\n')[0] }) });
    } catch (err) {
      const row = ledger.record(tally.finish({ ok: false, aborted: false, error: (err as Error).message, provider: run.provider }));
      Object.assign(run, { status: 'failed', costUsd: row.costUsd, error: (err as Error).message, finishedAt: new Date().toISOString() });
    } finally {
      this.saveEvals();
      await removeWorktree(project.root, dir).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
    }
  }

  private saveEvals() {
    fs.mkdirSync(path.dirname(this.evalsFile), { recursive: true });
    fs.writeFileSync(this.evalsFile, JSON.stringify(this.evals, null, 2) + '\n');
  }
}
