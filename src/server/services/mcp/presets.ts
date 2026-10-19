import type { McpPreset } from '../../../shared/types/index.js';

/** Servers offered in "Add server". Secrets are `${secret:NAME}` references, filled in from the UI. */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Issues, errors, stack traces, releases and Seer fixes from sentry.io.',
    config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
    auth: 'Sign in with your Sentry account in the browser (OAuth). Nothing to paste.',
    docs: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'sentry-token',
    name: 'Sentry (access token)',
    description: 'Same tools with a user auth token. Use it for self-hosted Sentry or when OAuth is not an option.',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@sentry/mcp-server@latest'],
      env: { SENTRY_ACCESS_TOKEN: '${secret:SENTRY_ACCESS_TOKEN}' },
    },
    secrets: [
      {
        name: 'SENTRY_ACCESS_TOKEN',
        label: 'User auth token',
        help: 'Scopes: org:read, project:read, project:write, team:read, team:write, event:write.',
        url: 'https://sentry.io/settings/account/api/auth-tokens/',
      },
    ],
    auth: 'Runs locally with npx; the token stays in .agentroom/runs/secrets.json.',
    docs: 'https://github.com/getsentry/sentry-mcp',
  },
];
