/**
 * String enums as `const` objects: usable as values (`BotStatus.Working`) and as types (`BotStatus`),
 * serialize as plain strings over the wire and in files, and need no runtime enum emit.
 */

type ValueOf<T> = T[keyof T];

export const BotStatus = {
  Idle: 'idle',
  Thinking: 'thinking',
  Working: 'working',
  Waiting: 'waiting',
  Error: 'error',
} as const;
export type BotStatus = ValueOf<typeof BotStatus>;

export const TaskStatus = {
  Todo: 'todo',
  Doing: 'doing',
  Review: 'review',
  Done: 'done',
} as const;
export type TaskStatus = ValueOf<typeof TaskStatus>;

/** What kind of work a task is. Drives who picks it up in a goal run. */
export const TaskKind = {
  /** Implementation work for the Developer. */
  Dev: 'dev',
  /** Verification work for QA. */
  QA: 'qa',
  /** A defect QA found; goes back to the Developer. */
  Bug: 'bug',
  /** Investigation / anything else. */
  Research: 'research',
} as const;
export type TaskKind = ValueOf<typeof TaskKind>;

/** Lifecycle of a goal run: plan → human review → build → test → report. */
export const GoalStatus = {
  Planning: 'planning',
  AwaitingApproval: 'awaiting_approval',
  Building: 'building',
  /** Security Auditor reviewing the diff (between Build and Test). */
  Securing: 'securing',
  Testing: 'testing',
  /** Proof of work: record the feature working and run quality checks (between Test and Report). */
  Verifying: 'verifying',
  Reporting: 'reporting',
  /** Waiting on the human (blocked task or question) or paused by them. */
  Paused: 'paused',
  Done: 'done',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type GoalStatus = ValueOf<typeof GoalStatus>;

export const NotificationKind = {
  /** The plan is ready for human review. */
  PlanReady: 'plan_ready',
  /** A bot asks the human something and waits for the answer. */
  Question: 'question',
  /** A bot is blocked and needs the human. */
  Blocked: 'blocked',
  /** Security findings need a decision. */
  Security: 'security',
  /** A goal finished. */
  GoalDone: 'goal_done',
  /** A goal failed. */
  GoalFailed: 'goal_failed',
  Info: 'info',
} as const;
export type NotificationKind = ValueOf<typeof NotificationKind>;

export const GithubContentType = {
  Issue: 'Issue',
  PullRequest: 'PullRequest',
  DraftIssue: 'DraftIssue',
} as const;
export type GithubContentType = ValueOf<typeof GithubContentType>;

/** Kinds of entries in the audit log. */
export const AuditKind = {
  Command: 'command',
  FileWrite: 'file_write',
  Push: 'push',
  PullRequest: 'pull_request',
  GithubWrite: 'github_write',
  Approval: 'approval',
  Handoff: 'handoff',
  Budget: 'budget',
  Security: 'security',
  Settings: 'settings',
  Goal: 'goal',
  /** A call to an external MCP server (Sentry, …). */
  Mcp: 'mcp',
  /** Schedules and triggers: created, changed, fired. */
  Automation: 'automation',
  /** Work from outside: Teams messages, Linear/Jira writes, PR reviews. */
  Intake: 'intake',
} as const;
export type AuditKind = ValueOf<typeof AuditKind>;

/** Who made a decision recorded in the audit log. */
export const ActorType = {
  /** The human, in the UI (named by their git user). */
  Human: 'human',
  /** Allowed automatically by the permission policy. */
  Policy: 'policy',
  /** Allowed by an "Always allow" rule from earlier in this session. */
  Session: 'session',
  /** The human, via remote (phone) approval. */
  Remote: 'remote',
  /** A bot acting on its own. */
  Bot: 'bot',
  /** AgentRoom itself (workflow engine, scheduler, guards). */
  System: 'system',
  /** Someone in an outside tool (a Teams user on the allow-list). */
  External: 'external',
} as const;
export type ActorType = ValueOf<typeof ActorType>;

/** Workflow phases used for model selection and budgets. */
export const WorkPhase = {
  Planning: 'planning',
  Build: 'build',
  Security: 'security',
  Testing: 'testing',
  Reporting: 'reporting',
  Chat: 'chat',
} as const;
export type WorkPhase = ValueOf<typeof WorkPhase>;

/** Per-goal security review setting. */
export const SecurityReviewMode = {
  /** On when risk is medium+ or sensitive paths are touched. */
  Auto: 'auto',
  Always: 'always',
  Off: 'off',
} as const;
export type SecurityReviewMode = ValueOf<typeof SecurityReviewMode>;

export const FindingSeverity = {
  /** Blocks commits/PRs until a human approves (by default). */
  Critical: 'critical',
  /** Needs acknowledgement. */
  Warning: 'warning',
  Info: 'info',
} as const;
export type FindingSeverity = ValueOf<typeof FindingSeverity>;

export const FindingCategory = {
  Secret: 'secret',
  Injection: 'injection',
  Crypto: 'crypto',
  Auth: 'auth',
  Cors: 'cors',
  Vulnerability: 'vulnerability',
  Typosquat: 'typosquat',
  InstallScript: 'install_script',
  PromptInjection: 'prompt_injection',
  Other: 'other',
} as const;
export type FindingCategory = ValueOf<typeof FindingCategory>;

/** Where a finding came from. */
export const FindingSource = {
  Scanner: 'scanner',
  Dependency: 'dependency',
  Review: 'review',
  Injection: 'injection',
} as const;
export type FindingSource = ValueOf<typeof FindingSource>;

export const FindingStatus = {
  Open: 'open',
  /** A human accepted the risk. */
  Approved: 'approved',
  /** A human marked it a false positive. */
  Dismissed: 'dismissed',
  /** No longer present in the diff. */
  Fixed: 'fixed',
} as const;
export type FindingStatus = ValueOf<typeof FindingStatus>;

export const RiskLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type RiskLevel = ValueOf<typeof RiskLevel>;

/** How an attachment reaches the model. */
export const AttachmentKind = {
  /** Sent as an image block (png, jpeg, gif, webp). */
  Image: 'image',
  /** Sent as a document block (PDF). */
  Pdf: 'pdf',
  /** Small text files, inlined as text. */
  Text: 'text',
  /** Anything else: saved to disk; the bot gets the path to read it with tools. */
  File: 'file',
} as const;
export type AttachmentKind = ValueOf<typeof AttachmentKind>;

/** How much a bot may do without asking the human. */
export const PermissionMode = {
  /** Every tool call needs approval. */
  AskAll: 'ask-all',
  /** Reads run freely; edits, shell and page actions need approval. */
  AskWrites: 'ask-writes',
  /** Only `alwaysAsk` commands need approval. */
  Auto: 'auto',
} as const;
export type PermissionMode = ValueOf<typeof PermissionMode>;

export const ProviderId = {
  Claude: 'claude',
} as const;
export type ProviderId = ValueOf<typeof ProviderId>;

/** How hard the model thinks before answering (provider permitting). */
export const EffortLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
  Max: 'max',
} as const;
export type EffortLevel = ValueOf<typeof EffortLevel>;

/** Where a skill lives: the shared library, or a single bot's folder. */
export const SkillScope = {
  Library: 'library',
  Bot: 'bot',
} as const;
export type SkillScope = ValueOf<typeof SkillScope>;

/** Built-in agent tools a bot can be given (plus `Browser`, AgentRoom's in-app browser). */
export const ToolName = {
  Read: 'Read',
  Grep: 'Grep',
  Glob: 'Glob',
  Edit: 'Edit',
  MultiEdit: 'MultiEdit',
  Write: 'Write',
  NotebookEdit: 'NotebookEdit',
  Bash: 'Bash',
  WebSearch: 'WebSearch',
  WebFetch: 'WebFetch',
  TodoWrite: 'TodoWrite',
  Skill: 'Skill',
  Browser: 'Browser',
} as const;
export type ToolName = ValueOf<typeof ToolName>;

/** Tools AgentRoom itself provides to bots. */
export const HostTool = {
  TaskList: 'task_list',
  TaskCreate: 'task_create',
  TaskUpdate: 'task_update',
  TaskGet: 'task_get',
  TaskDelete: 'task_delete',
  PlanOverview: 'plan_overview',
  SecurityFinding: 'security_finding',
  NotifyHuman: 'notify_human',
  AskHuman: 'ask_human',
  Delegate: 'delegate',
  /** Suggest a note for the bot's memory (the human keeps or ignores it). */
  MemoryNote: 'memory_note',
  /** Repo context (read-only map of modules, cards and dependencies). */
  ContextOverview: 'context_overview',
  ContextModule: 'context_module',
  ContextFind: 'context_find',
  ContextDeps: 'context_deps',
  ContextImpact: 'context_impact',
  BrowserOpen: 'browser_open',
  BrowserSnapshot: 'browser_snapshot',
  BrowserClick: 'browser_click',
  BrowserType: 'browser_type',
  BrowserPress: 'browser_press',
  BrowserWaitFor: 'browser_wait_for',
  BrowserBack: 'browser_back',
  BrowserConsole: 'browser_console',
  BrowserEval: 'browser_eval',
} as const;
export type HostTool = ValueOf<typeof HostTool>;

export const ConsoleLevel = {
  Log: 'log',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
  Network: 'network',
} as const;
export type ConsoleLevel = ValueOf<typeof ConsoleLevel>;

export const RateLimitStatus = {
  Allowed: 'allowed',
  Warning: 'allowed_warning',
  Rejected: 'rejected',
} as const;
export type RateLimitStatus = ValueOf<typeof RateLimitStatus>;

/** Commands the preview bridge script executes inside a page. */
export const BridgeOp = {
  Snapshot: 'snapshot',
  Click: 'click',
  Type: 'type',
  Press: 'press',
  WaitFor: 'wait_for',
  Back: 'back',
  Eval: 'eval',
} as const;
export type BridgeOp = ValueOf<typeof BridgeOp>;

export const AgentEventType = {
  BotStatus: 'bot_status',
  UserMessage: 'user_message',
  Message: 'message',
  ToolCall: 'tool_call',
  ToolResult: 'tool_result',
  PermissionRequest: 'permission_request',
  PermissionResolved: 'permission_resolved',
  Delegation: 'delegation',
  RunDone: 'run_done',
  Usage: 'usage',
  RateLimit: 'rate_limit',
  Error: 'error',
} as const;
export type AgentEventType = ValueOf<typeof AgentEventType>;

export const StreamDeltaType = {
  TextStart: 'text_start',
  Text: 'text',
  Thinking: 'thinking',
  ToolStart: 'tool_start',
} as const;
export type StreamDeltaType = ValueOf<typeof StreamDeltaType>;

/** Server → UI WebSocket message kinds. */
export const ServerMessageKind = {
  Hello: 'hello',
  Event: 'event',
  State: 'state',
  Stream: 'stream',
  Preview: 'preview',
  Console: 'console',
  BridgeCmd: 'bridge_cmd',
  Account: 'account',
  Notification: 'notification',
  /** Shared team room: presence, comments, per-person notifications. */
  Room: 'room',
} as const;
export type ServerMessageKind = ValueOf<typeof ServerMessageKind>;

/** Full-state pushes (after file changes). */
export const StateType = {
  Bots: 'bots',
  Skills: 'skills',
  Tasks: 'tasks',
  Goals: 'goals',
  Settings: 'settings',
  Findings: 'findings',
  Config: 'config',
  Mcp: 'mcp',
  Automation: 'automation',
  /** Repo context status (sync progress, card counts). */
  Context: 'context',
} as const;
export type StateType = ValueOf<typeof StateType>;

/** UI → server WebSocket message types. */
export const ClientMessageType = {
  Send: 'send',
  Stop: 'stop',
  Permission: 'permission',
  Focus: 'focus',
  BrowserOpen: 'browser_open',
  BrowserClose: 'browser_close',
  BrowserControl: 'browser_control',
  BridgeReady: 'bridge_ready',
  BridgeConsole: 'bridge_console',
  BridgeResult: 'bridge_result',
  /** Answer a bot's question (ask_human). */
  Answer: 'answer',
  /** Mark notifications read. */
  NotificationsRead: 'notifications_read',
  /** Whether this UI tab is visible and focused (drives "only when I'm away" alerts). */
  Presence: 'presence',
} as const;
export type ClientMessageType = ValueOf<typeof ClientMessageType>;

/** Connection state of an external MCP server (the SDK's statuses plus AgentRoom's own checks). */
export const McpStatus = {
  Connected: 'connected',
  /** The server wants an OAuth sign-in. */
  NeedsAuth: 'needs-auth',
  Failed: 'failed',
  Pending: 'pending',
  Disabled: 'disabled',
  /** A `${secret:NAME}` it references isn't set yet; it isn't started until it is. */
  MissingSecret: 'missing-secret',
  /** Not checked yet. */
  Unknown: 'unknown',
} as const;
export type McpStatus = ValueOf<typeof McpStatus>;

/** Where an AgentRoom MCP server is defined. */
export const McpScope = {
  /** `.agentroom/mcp.json`, committed: everyone on the team gets it. */
  Team: 'team',
  /** `.agentroom/runs/mcp.local.json`: only this machine (personal connectors, private servers). */
  Personal: 'personal',
} as const;
export type McpScope = ValueOf<typeof McpScope>;
