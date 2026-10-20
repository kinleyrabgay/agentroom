import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ActorType, AuditKind } from '../../shared/enums.js';
import type { Bot, PrReview, PrReviewComment, PrReviewDetail, PrReviewEvent, PrReviewFile } from '../../shared/types/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';
import type { NewAuditEntry } from '../services/audit.service.js';
import { wrapUntrusted } from '../security/injection.js';
import { resolveLead } from '../workflow/roles.js';
import { commentableLines, splitDiff } from './diff.js';

const DIFF_PROMPT_MAX = 80_000;
const FILE_DIFF_MAX = 60_000;
const MAX_COMMENTS = 30;
const EVENTS: PrReviewEvent[] = ['COMMENT', 'REQUEST_CHANGES', 'APPROVE'];
const SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const;

export interface Exec {
  (cmd: string, args: string[], opts: { cwd: string; input?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface PrReviewDeps {
  root: string;
  /** `runs/reviews.json` and `runs/reviews/<id>.diff`. */
  file: string;
  diffDir: string;
  /** Where review checkouts go (outside the repo, next to goal worktrees). */
  worktreeDir: string;
  bots: () => Bot[];
  /** Run a bot in a folder and get its final answer. */
  dispatch: (botId: string, text: string, opts: { cwd: string }) => Promise<{ ok: boolean; text: string }>;
  /** Make every shell command of this bot ask (untrusted fork PRs); null lifts it. */
  strict: (botId: string, reason: string | null) => void;
  audit: (e: NewAuditEntry) => void;
  changed?: () => void;
  exec?: Exec;
  now?: () => Date;
}

interface Store {
  reviews: PrReview[];
}

/** "https://github.com/o/r/pull/12", "o/r#12", "#12" or "12" (this repo). */
export function parsePrRef(input: string): { repo?: string; number: number } {
  const s = input.trim();
  let m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(s);
  if (m) return { repo: m[1]!.replace(/\.git$/, ''), number: Number(m[2]) };
  m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s);
  if (m) return { repo: m[1]!, number: Number(m[2]) };
  m = /^#?(\d+)$/.exec(s);
  if (m) return { number: Number(m[1]) };
  throw new Error('Paste a pull request link, like https://github.com/owner/repo/pull/12.');
}

/**
 * PR review from a link: check the PR out in its own folder, let the Reviewer draft comments,
 * show them for editing, and post to GitHub only when the human clicks Post.
 */
export class PrReviewService {
  private store: Store;

  constructor(private readonly deps: PrReviewDeps) {
    this.store = readJson<Store>(deps.file, { reviews: [] });
    // A server restart interrupts runs: they become failed, never stuck.
    for (const r of this.store.reviews) if (r.state === 'preparing' || r.state === 'reviewing') Object.assign(r, { state: 'failed', error: 'AgentRoom restarted during the review. Run it again.' });
  }

  private now() {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private exec(cmd: string, args: string[], opts: { cwd: string; input?: string }) {
    return (this.deps.exec ?? execCmd)(cmd, args, opts);
  }

  private async must(cmd: string, args: string[], cwd: string, input?: string) {
    const out = await this.exec(cmd, args, { cwd, ...(input !== undefined ? { input } : {}) });
    if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim().split('\n').slice(-3).join(' ') || `${cmd} ${args[0]} failed`);
    return out.stdout;
  }

  list(): PrReview[] {
    return [...this.store.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): PrReview {
    const r = this.store.reviews.find((x) => x.id === id);
    if (!r) throw new Error(`No review ${id}.`);
    return r;
  }

  detail(id: string): PrReviewDetail {
    const review = this.get(id);
    const diff = fs.existsSync(this.diffFile(id)) ? fs.readFileSync(this.diffFile(id), 'utf8') : '';
    const files: PrReviewFile[] = splitDiff(diff).map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      diff: f.diff.length > FILE_DIFF_MAX ? f.diff.slice(0, FILE_DIFF_MAX) : f.diff,
      truncated: f.diff.length > FILE_DIFF_MAX,
    }));
    return { review, files };
  }

  private diffFile(id: string) {
    return path.join(this.deps.diffDir, `${id}.diff`);
  }

  private set(id: string, patch: Partial<PrReview>): PrReview {
    const r = this.get(id);
    Object.assign(r, patch, { updatedAt: this.now() });
    this.save();
    this.deps.changed?.();
    return r;
  }

  private save() {
    writeJson(this.deps.file, { reviews: this.store.reviews.slice(-100) });
  }

  private reviewer(botId?: string): Bot {
    const bots = this.deps.bots();
    const bot = botId
      ? bots.find((b) => b.id === botId)
      : (bots.find((b) => b.role.toLowerCase() === 'reviewer') ?? bots.find((b) => /review/i.test(b.id) && !/security/i.test(b.id)) ?? resolveLead(bots));
    if (!bot) throw new Error(botId ? `Unknown bot "${botId}".` : 'No Reviewer bot found.');
    return bot;
  }

  /** owner/name of this repo's GitHub remote. */
  private async originRepo(): Promise<string | undefined> {
    const out = await this.exec('git', ['remote', 'get-url', 'origin'], { cwd: this.deps.root });
    return /github\.com[/:]([^/]+\/[^/.\s]+?)(?:\.git)?\s*$/.exec(out.stdout.trim())?.[1];
  }

  /** Start reviewing a PR. Returns at once; the review fills in as the bot works. */
  async start(input: { url: string; botId?: string; by: string }): Promise<PrReview> {
    const ref = parsePrRef(input.url);
    const origin = await this.originRepo();
    const repo = ref.repo ?? origin;
    if (!repo) throw new Error('This repo has no GitHub remote; paste the full PR link.');
    if (origin && repo.toLowerCase() !== origin.toLowerCase()) throw new Error(`That PR is in ${repo}, but this project is ${origin}. Open AgentRoom in that repo to review it.`);
    const bot = this.reviewer(input.botId);
    const busy = this.store.reviews.find((r) => r.repo === repo && r.number === ref.number && (r.state === 'preparing' || r.state === 'reviewing'));
    if (busy) throw new Error(`#${ref.number} is already being reviewed.`);

    const metaRaw = await this.must(
      'gh',
      ['pr', 'view', String(ref.number), '-R', repo, '--json', 'number,title,author,headRefName,baseRefName,headRefOid,isCrossRepository,url,additions,deletions,changedFiles,body'],
      this.deps.root,
    );
    const meta = JSON.parse(metaRaw) as {
      number: number;
      title: string;
      author?: { login: string };
      headRefName: string;
      baseRefName: string;
      headRefOid: string;
      isCrossRepository: boolean;
      url: string;
      additions: number;
      deletions: number;
      changedFiles: number;
      body: string;
    };
    const id = `R-${this.store.reviews.reduce((n, r) => Math.max(n, Number(r.id.slice(2)) || 0), 0) + 1}`;
    const now = this.now();
    const review: PrReview = {
      id,
      url: meta.url,
      repo,
      number: meta.number,
      title: meta.title,
      author: meta.author?.login ?? 'unknown',
      headRef: meta.headRefName,
      baseRef: meta.baseRefName,
      headSha: meta.headRefOid,
      description: (meta.body ?? '').slice(0, 20_000),
      fork: meta.isCrossRepository,
      allowScripts: !meta.isCrossRepository,
      state: 'preparing',
      botId: bot.id,
      additions: meta.additions,
      deletions: meta.deletions,
      changedFiles: meta.changedFiles,
      summary: '',
      suggestedEvent: 'COMMENT',
      comments: [],
      general: [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.reviews.push(review);
    this.save();
    this.deps.audit({ kind: AuditKind.Intake, actor: { type: ActorType.Human, name: input.by }, summary: `Started a review of ${repo}#${meta.number}`, botId: bot.id, detail: { review: id, fork: meta.isCrossRepository } });
    this.deps.changed?.();
    void this.run(id);
    return review;
  }

  /** Run (or re-run) the bot on a prepared PR. */
  private async run(id: string) {
    try {
      const r = this.get(id);
      const dir = path.join(this.deps.worktreeDir, `pr-${r.number}`);
      // Fresh checkout every time: the PR may have new commits.
      if (fs.existsSync(dir)) await this.exec('git', ['worktree', 'remove', '--force', dir], { cwd: this.deps.root });
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await this.must('git', ['worktree', 'add', '--detach', dir, 'HEAD'], this.deps.root);
      await this.must('gh', ['pr', 'checkout', String(r.number), '-R', r.repo, '--detach', '--force'], dir);
      const diff = await this.must('gh', ['pr', 'diff', String(r.number), '-R', r.repo], dir);
      fs.mkdirSync(this.deps.diffDir, { recursive: true });
      fs.writeFileSync(this.diffFile(id), diff);
      this.set(id, { worktree: dir, state: 'reviewing', error: undefined });

      const strictReason = r.fork && !r.allowScripts ? `${r.repo}#${r.number} comes from a fork: its scripts and tests run only if you allow each command.` : null;
      this.deps.strict(r.botId, strictReason);
      let out: { ok: boolean; text: string };
      try {
        out = await this.deps.dispatch(r.botId, reviewPrompt(r, r.description ?? '', diff), { cwd: dir });
      } finally {
        this.deps.strict(r.botId, null);
      }
      if (!out.ok) throw new Error(out.text || 'The review run failed.');
      const draft = parseDraft(out.text, diff);
      this.set(id, { state: 'ready', summary: draft.summary, suggestedEvent: draft.event, comments: draft.comments, general: draft.general });
    } catch (err) {
      this.set(id, { state: 'failed', error: (err as Error).message });
    }
  }

  /** Re-run the review, optionally allowing a fork's scripts (an explicit human decision, audited). */
  rerun(id: string, opts: { allowScripts?: boolean; by: string }): PrReview {
    const r = this.get(id);
    if (r.state === 'preparing' || r.state === 'reviewing') throw new Error(`${id} is still running.`);
    if (opts.allowScripts && r.fork && !r.allowScripts) {
      this.deps.audit({ kind: AuditKind.Approval, actor: { type: ActorType.Human, name: opts.by }, summary: `Allowed running scripts from fork PR ${r.repo}#${r.number}`, decision: 'allowed' });
    }
    const updated = this.set(id, { state: 'preparing', ...(opts.allowScripts ? { allowScripts: true } : {}), error: undefined });
    void this.run(id);
    return updated;
  }

  /** Edit the draft: summary, event, comments (add/edit/remove). */
  update(id: string, patch: { summary?: string; suggestedEvent?: PrReviewEvent; comments?: PrReviewComment[]; general?: string[] }): PrReview {
    const r = this.get(id);
    if (r.state === 'posted') throw new Error('This review was already posted.');
    const next: Partial<PrReview> = {};
    if (patch.summary !== undefined) next.summary = String(patch.summary).slice(0, 20_000);
    if (patch.suggestedEvent !== undefined) {
      if (!EVENTS.includes(patch.suggestedEvent)) throw new Error('Unknown review type.');
      next.suggestedEvent = patch.suggestedEvent;
    }
    if (patch.general !== undefined) next.general = patch.general.map(String).filter((g) => g.trim()).slice(0, 50);
    if (patch.comments !== undefined) {
      const diff = fs.existsSync(this.diffFile(id)) ? fs.readFileSync(this.diffFile(id), 'utf8') : '';
      const ok = commentableLines(diff);
      next.comments = patch.comments.slice(0, 100).map((c) => {
        const side = c.side === 'LEFT' ? 'LEFT' : 'RIGHT';
        const line = Number(c.line);
        if (!ok.has(`${c.path}:${side}:${line}`)) throw new Error(`${c.path} line ${line} isn't part of the diff, so GitHub can't attach a comment there.`);
        const body = String(c.body ?? '').trim();
        if (!body) throw new Error('A comment is empty.');
        return { id: c.id || randomUUID(), path: c.path, line, side, body: body.slice(0, 8000), severity: SEVERITIES.includes(c.severity) ? c.severity : 'minor', author: c.author === 'bot' ? 'bot' : 'human' };
      });
    }
    return this.set(id, next);
  }

  /** Post the review to GitHub. Only ever called from the human's click. */
  async post(id: string, input: { event: PrReviewEvent; by: string }): Promise<PrReview> {
    const r = this.get(id);
    if (r.state !== 'ready') throw new Error(r.state === 'posted' ? 'Already posted.' : 'The review isn’t ready yet.');
    if (!EVENTS.includes(input.event)) throw new Error('Unknown review type.');
    const body = [r.summary.trim(), ...(r.general.length ? ['', '**Other notes**', ...r.general.map((g) => `- ${g}`)] : []), '', '_Drafted with AgentRoom, reviewed by a human before posting._']
      .join('\n')
      .trim();
    if (input.event !== 'APPROVE' && !body && !r.comments.length) throw new Error('Write a summary or at least one comment.');
    const payload = {
      commit_id: r.headSha,
      event: input.event,
      body,
      comments: r.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.severity === 'nit' ? `nit: ${c.body}` : c.body })),
    };
    await this.must('gh', ['api', '--method', 'POST', `repos/${r.repo}/pulls/${r.number}/reviews`, '--input', '-'], this.deps.root, JSON.stringify(payload));
    this.deps.audit({
      kind: AuditKind.GithubWrite,
      actor: { type: ActorType.Human, name: input.by },
      summary: `Posted a ${input.event.toLowerCase().replace('_', ' ')} review on ${r.repo}#${r.number} (${r.comments.length} comments)`,
      botId: r.botId,
      decision: 'allowed',
      detail: { review: id, url: r.url },
    });
    return this.set(id, { state: 'posted', postedAt: this.now(), postedEvent: input.event, postedBy: input.by });
  }

  /** Remove the review's checkout folder (the record stays). */
  async cleanup(id: string): Promise<PrReview> {
    const r = this.get(id);
    if (r.state === 'preparing' || r.state === 'reviewing') throw new Error(`${id} is still running.`);
    if (r.worktree && fs.existsSync(r.worktree)) await this.exec('git', ['worktree', 'remove', '--force', r.worktree], { cwd: this.deps.root });
    return this.set(id, { worktree: undefined });
  }

  remove(id: string) {
    const r = this.get(id);
    if (r.state === 'preparing' || r.state === 'reviewing') throw new Error(`${id} is still running.`);
    this.store.reviews = this.store.reviews.filter((x) => x.id !== id);
    fs.rmSync(this.diffFile(id), { force: true });
    this.save();
    this.deps.changed?.();
  }
}

function reviewPrompt(r: PrReview, description: string, diff: string): string {
  const cut = diff.length > DIFF_PROMPT_MAX;
  const shown = cut ? `${diff.slice(0, DIFF_PROMPT_MAX)}\n… (diff cut; read the remaining files in your folder)` : diff;
  return [
    `Review pull request ${r.repo}#${r.number}: "${r.title}" by @${r.author} (${r.headRef} → ${r.baseRef}).`,
    `Your working folder is a checkout of the PR head. ${r.changedFiles} files changed (+${r.additions} −${r.deletions}).`,
    r.fork && !r.allowScripts
      ? 'This PR comes from a fork. Do NOT run its scripts, tests, builds or package installs: review by reading the code. Any command you try will need the human’s approval.'
      : 'You may run the project’s tests or type checks to confirm a problem, but don’t change files.',
    'Use the context_* tools to see what depends on the changed code. Never post to GitHub yourself: the human edits your draft and posts it.',
    '',
    '## Description',
    wrapUntrusted(description.trim() || '(no description)', `PR ${r.repo}#${r.number} description`),
    '',
    '## Diff',
    wrapUntrusted(shown, `PR ${r.repo}#${r.number} diff`),
    '',
    '## Your answer',
    'Focus on bugs, security, data loss, missing tests and behaviour changes. At most 25 comments; skip style nits unless they matter.',
    'Line numbers: for added or unchanged lines use the new file’s line and side "RIGHT"; for removed lines use the old line and side "LEFT". Only lines inside the diff can be commented.',
    'End with ONLY this JSON block:',
    '```json',
    '{"summary": "2-6 sentences, markdown", "event": "COMMENT | REQUEST_CHANGES | APPROVE", "comments": [{"path": "src/file.ts", "line": 42, "side": "RIGHT", "severity": "blocker | major | minor | nit", "body": "what is wrong and how to fix it"}]}',
    '```',
  ].join('\n');
}

/** The bot's JSON, with comments outside the diff moved to general notes. */
export function parseDraft(text: string, diff: string): { summary: string; event: PrReviewEvent; comments: PrReviewComment[]; general: string[] } {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  const candidates = [...blocks.reverse(), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  type Draft = { summary?: unknown; event?: unknown; comments?: unknown };
  let data: Draft | null = null;
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as Draft | null;
      if (parsed && typeof parsed === 'object') {
        data = parsed;
        break;
      }
    } catch {
      // try the next block
    }
  }
  if (!data) return { summary: text.trim().slice(0, 5000), event: 'COMMENT', comments: [], general: [] };
  const ok = commentableLines(diff);
  const comments: PrReviewComment[] = [];
  const general: string[] = [];
  for (const raw of Array.isArray(data.comments) ? data.comments.slice(0, MAX_COMMENTS) : []) {
    const c = raw as Record<string, unknown>;
    const p = String(c.path ?? '').replace(/^[ab]\//, '');
    const line = Number(c.line);
    const side = c.side === 'LEFT' ? 'LEFT' : 'RIGHT';
    const body = String(c.body ?? '').trim();
    if (!p || !body) continue;
    const severity = SEVERITIES.includes(c.severity as (typeof SEVERITIES)[number]) ? (c.severity as PrReviewComment['severity']) : 'minor';
    if (Number.isInteger(line) && ok.has(`${p}:${side}:${line}`)) comments.push({ id: randomUUID(), path: p, line, side, body, severity, author: 'bot' });
    else general.push(`\`${p}${Number.isInteger(line) && line > 0 ? `:${line}` : ''}\`: ${body}`);
  }
  const event = EVENTS.includes(data.event as PrReviewEvent) ? (data.event as PrReviewEvent) : 'COMMENT';
  return { summary: String(data.summary ?? '').trim(), event, comments, general };
}

/** Run a command, optionally feeding stdin. */
const execCmd: Exec = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
