import type { ToolStep } from "./transcript"

/** How a kind of tool reads in a sentence: "Read 3 files", "Ran 2 commands". */
export interface ToolKind {
  key: string
  /** While it runs: "Reading". */
  active: string
  /** Done, with a count: (n) => "Read 3 files". */
  done: (n: number) => string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const KINDS: Record<string, ToolKind> = {
  read: { key: "read", active: "Reading", done: (n) => `Read ${plural(n, "file")}` },
  edit: { key: "edit", active: "Editing", done: (n) => `Edited ${plural(n, "file")}` },
  shell: { key: "shell", active: "Running", done: (n) => `Ran ${plural(n, "command")}` },
  search: { key: "search", active: "Searching", done: (n) => `Ran ${plural(n, "search", "searches")}` },
  web: { key: "web", active: "Browsing", done: (n) => `Read ${plural(n, "web page")}` },
  plan: { key: "plan", active: "Planning", done: () => "Updated the plan" },
  agent: { key: "agent", active: "Delegating", done: (n) => `Ran ${plural(n, "subagent")}` },
  skill: { key: "skill", active: "Using a skill", done: (n) => `Used ${plural(n, "skill")}` },
  browser: { key: "browser", active: "Using the browser", done: (n) => `Took ${plural(n, "browser step")}` },
  board: { key: "board", active: "Updating the board", done: (n) => `Made ${plural(n, "board update")}` },
  other: { key: "other", active: "Using", done: (n) => `Used ${plural(n, "tool")}` },
}

const BY_NAME: Record<string, string> = {
  Read: "read",
  NotebookRead: "read",
  LS: "read",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  BashOutput: "shell",
  KillShell: "shell",
  Grep: "search",
  Glob: "search",
  WebFetch: "web",
  WebSearch: "web",
  TodoWrite: "plan",
  Task: "agent",
  Agent: "agent",
  Skill: "skill",
}

export function kindOf(name: string): ToolKind {
  const mapped = BY_NAME[name]
  if (mapped) return KINDS[mapped]!
  if (name.startsWith("browser_")) return KINDS.browser!
  if (name.startsWith("task_") || name.startsWith("goal_")) return KINDS.board!
  return KINDS.other!
}

/**
 * One sentence for a group of tool calls, in the order the kinds first appear:
 * "Read 3 files · Ran 2 commands". Files read or edited twice count once.
 */
export function describeSteps(steps: ToolStep[]): string {
  const order: string[] = []
  const counts = new Map<string, Set<string>>()
  for (const s of steps) {
    const k = kindOf(s.name)
    if (!counts.has(k.key)) {
      counts.set(k.key, new Set())
      order.push(k.key)
    }
    const fileish = k.key === "read" || k.key === "edit"
    counts.get(k.key)!.add(fileish && s.summary ? s.summary : s.id)
  }
  return order.map((key) => KINDS[key]!.done(counts.get(key)!.size)).join(" · ")
}
