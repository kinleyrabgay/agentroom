/** Constants shared by the CLI, server and web UI. Keep this file dependency-free. */

export const APP_NAME = 'AgentRoom';
export const APP_VERSION = '0.0.3';

/** Folder AgentRoom creates in the user's project. */
export const PROJECT_DIR = '.agentroom';
/** Claude plugin name of the shared skill library (`.agentroom/`). Skills are addressed as `agentroom:<skill>`. */
export const LIBRARY_PLUGIN = 'agentroom';
/** Prefix of a bot's own plugin (its folder). Bot skills are addressed as `agentroom-bot-<id>:<skill>`. */
export const BOT_PLUGIN_PREFIX = 'agentroom-bot-';

export const DEFAULT_PORT = 4317;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const BIND_HOST = '127.0.0.1';
/**
 * Hostname the UI is opened on. Previews are served under `localhost` too (apps often check
 * `location.hostname === 'localhost'`), and the UI must be the same site as them or the browser
 * treats the preview as a third-party frame and drops its cookies and storage.
 */
export const PUBLIC_HOST = 'localhost';

export const API_PREFIX = '/api';
export const WS_PATH = '/ws';
export const TOKEN_HEADER = 'x-agentroom-token';
export const TOKEN_QUERY = 't';

/** Skill and bot folder names: lowercase letters, digits and dashes. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Default personal alert preferences. */
export const DEFAULT_ALERT_PREFS = {
  system: true,
  sound: true,
  soundName: 'Glass',
  voice: false,
  onlyWhenAway: true,
} as const;

/** Attachment limits (per file / per message). Images above the API's limit are rejected with a clear message. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 10;

/** `bots` value in mcp.json meaning every bot may use the server. */
export const MCP_ALL_BOTS = '*';
/** Tools of external MCP servers are named `mcp__<server>__<tool>`. */
export const MCP_TOOL_PREFIX = 'mcp__';
