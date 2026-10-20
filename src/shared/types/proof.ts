/** One step of a proof scenario. Mirrors the browser_* tool vocabulary bots already know. */
export interface ProofStep {
  action: 'goto' | 'click' | 'fill' | 'press' | 'wait' | 'expect' | 'screenshot';
  /** goto: a path ("/reports") or URL on the app; click/fill/wait: a CSS selector or `text=…`; press: a key. */
  target?: string;
  /** fill: the text to type; expect/wait: text that must appear; wait: milliseconds when a number. */
  value?: string;
  /** Caption for the frame taken after this step. */
  label?: string;
}

export interface ProofScenario {
  name: string;
  /** Path the scenario starts on (default "/"). */
  path?: string;
  steps: ProofStep[];
}

export interface ProofFrame {
  /** File name inside the goal's proof folder. */
  file: string;
  label: string;
  /** Index of the step it follows (-1 = page loaded). */
  step: number;
  ok: boolean;
}

export interface ProofScenarioResult {
  name: string;
  ok: boolean;
  /** What failed, in words the Developer can act on. */
  error?: string;
  failedStep?: number;
  frames: ProofFrame[];
  /** Animated recording of the frames. */
  gif?: string;
  /** "Before" screenshots of the same pages on the goal's starting commit. */
  before: ProofFrame[];
}

export type ProofCheckId = 'a11y' | 'perf' | 'bundle' | 'coverage' | 'visual';
export type ProofCheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface ProofCheck {
  id: ProofCheckId;
  label: string;
  status: ProofCheckStatus;
  /** One line: "2 new accessibility issues", "LCP 1.4 s". */
  summary: string;
  value?: number;
  base?: number;
  threshold?: number;
  details?: string[];
}

export type ProofStatus = 'passed' | 'failed' | 'skipped' | 'error';

/** `runs/proof/<G-n>/report.json`. */
export interface ProofReport {
  goalId: string;
  round: number;
  status: ProofStatus;
  /** Why it was skipped or errored. */
  reason?: string;
  startedAt: string;
  finishedAt: string;
  url?: string;
  scenarios: ProofScenarioResult[];
  checks: ProofCheck[];
  /** Set after the images were pushed to the proof branch. */
  published?: { branch: string; sha: string; base: string };
}

/** What the goal keeps about its last proof run (the full report lives in runs/proof). */
export interface ProofSummary {
  round: number;
  status: ProofStatus;
  at: string;
  summary: string;
  /** Labels of failing checks (the quality gate). */
  failing: string[];
  gif?: boolean;
}

/** Whether this machine can record proof (headless browser available). */
export interface ProofAvailability {
  ok: boolean;
  reason?: string;
  browser?: string;
}

export interface ProofView {
  report: ProofReport | null;
  scenarios: ProofScenario[];
  availability: ProofAvailability;
  running: boolean;
}
