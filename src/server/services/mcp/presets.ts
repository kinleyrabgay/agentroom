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
  {
    id: 'figma',
    name: 'Figma',
    description: 'Frames, layout, styles and variables from Figma designs (Implement design goals).',
    config: { type: 'http', url: 'https://mcp.figma.com/mcp' },
    auth: 'Sign in with your Figma account in the browser (OAuth). For design-match scores, also add a FIGMA_ACCESS_TOKEN (Figma access token preset) or attach the design image.',
    docs: 'https://help.figma.com/hc/en-us/articles/32132100833559',
  },
  {
    id: 'figma-token',
    name: 'Figma (access token)',
    description: 'Figma frames and layout through a personal access token. The same token lets Verify export the frame to score the design match.',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'figma-developer-mcp', '--stdio'],
      env: { FIGMA_API_KEY: '${secret:FIGMA_ACCESS_TOKEN}' },
    },
    secrets: [
      {
        name: 'FIGMA_ACCESS_TOKEN',
        label: 'Personal access token',
        help: 'Read-only scopes are enough: file content (read).',
        url: 'https://www.figma.com/developers/api#access-tokens',
      },
    ],
    auth: 'Runs locally with npx; the token stays in .agentroom/runs/secrets.json and is only used to read files.',
    docs: 'https://github.com/GLips/Figma-Context-MCP',
  },
];
