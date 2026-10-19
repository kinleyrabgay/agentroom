/** Server-side tunables. User-facing/shared constants live in src/shared/constants.ts. */

/** Events kept in memory for UIs that connect later. */
export const HISTORY_LIMIT = 3000;
/** Console lines kept per preview. */
export const CONSOLE_LIMIT = 300;
/** Console lines returned to a bot by browser_console. */
export const CONSOLE_TAIL = 60;
/** Tool output kept per tool_result event. */
export const TOOL_OUTPUT_LIMIT = 4000;
/** CLAUDE.md characters included in a bot's context. */
export const CLAUDE_MD_LIMIT = 8000;

/** Debounce for pushing `.agentroom/` file changes to the UI. */
export const WATCH_DEBOUNCE_MS = 120;

/** Account plan usage refresh cadence (only while a UI is connected). */
export const ACCOUNT_POLL_MS = 120_000;
export const ACCOUNT_REFRESH_AFTER_RUN_MS = 3000;
export const ACCOUNT_FETCH_TIMEOUT_MS = 20_000;

/** In-app browser bridge timings. */
export const BRIDGE_COMMAND_TIMEOUT_MS = 15_000;
export const BRIDGE_QUICK_SNAPSHOT_MS = 4000;
export const PAGE_LOAD_TIMEOUT_MS = 20_000;
export const PAGE_RELOAD_TIMEOUT_MS = 10_000;
export const ACTION_SETTLE_MS = 450;
export const WAIT_FOR_DEFAULT_MS = 5000;
export const WAIT_FOR_GRACE_MS = 3000;

/** Name of the in-process MCP server that exposes AgentRoom's host tools. */
export const HOST_MCP_SERVER = 'agentroom';
export const HOST_TOOL_PREFIX = `mcp__${HOST_MCP_SERVER}__`;

/** Routes served by every preview proxy. */
export const BRIDGE_SCRIPT_PATH = '/__agentroom/bridge.js';

/** WebSocket close code for a bad session token. */
export const WS_UNAUTHORIZED = 4401;

/** How long to wait for the provider's model list at startup. */
export const MODEL_FETCH_TIMEOUT_MS = 20_000;

/** Notifications kept in the inbox. */
export const INBOX_LIMIT = 200;

/** Goal workflow: build→test loops before the engine stops and asks the human. */
export const MAX_FIX_ROUNDS = 2;
/** Goal titles are cut from the first line of the brief. */
export const GOAL_TITLE_MAX = 80;

/** Spoken alerts: never closer than this, and the same line not twice within the dedupe window. */
export const VOICE_MIN_GAP_MS = 3000;
export const VOICE_DEDUPE_MS = 15_000;

/** GitHub board: columns are re-synced at most daily unless asked; items are paged 100 at a time. */
export const GITHUB_COLUMNS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const GITHUB_MAX_PAGES = 20;
/** Comments included per card in a hand-off brief. */
export const HANDOFF_COMMENTS = 5;
/** Max files returned by GET /api/files. */
export const FILES_LIMIT_MAX = 100;

/** Audit entries kept in memory for fast queries; older ones are read from disk on demand. */
export const AUDIT_MEMORY_LIMIT = 20_000;
export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 500;
