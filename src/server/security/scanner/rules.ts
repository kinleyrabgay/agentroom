import { FindingCategory, FindingSeverity } from '../../../shared/enums.js';

/**
 * Line rules for the secret & risk scanner. Severity mapping:
 * - Critical: anything that leaks a credential (real token formats, private keys, hardcoded secrets, committed .env).
 * - Warning: code patterns that are often unsafe and need a human look (eval, shell/SQL injection, disabled TLS,
 *   weakened auth, wide-open CORS, weak crypto).
 */
export interface LineRule {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  /** Markdown: why it matters and how to fix it. */
  detail: string;
  pattern: RegExp;
  /** Matched text is a secret: redact it in snippets. */
  secret?: boolean;
  /** Heuristic (not a known token format): skipped in fixtures/snapshots/tests data. */
  generic?: boolean;
  /** Extra check on the line (e.g. placeholder exclusion). */
  accept?: (line: string, match: RegExpExecArray) => boolean;
}

const SECRET_FIX = 'Remove it from the code, rotate the credential, and load it from the environment or a secret manager instead.';

/** Values that are clearly not real secrets. */
const PLACEHOLDER = /^(x+|\*+|\.+|changeme|change[-_]me|example|sample|dummy|test|testing|placeholder|your[-_ ].*|<.*>|\$\{.*\}|\{\{.*\}\}|todo|redacted|none|null|undefined|password|secret|token)$/i;

export const LINE_RULES: LineRule[] = [
  // ---- secrets (critical) ----
  {
    id: 'secret.aws-access-key',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'AWS access key',
    detail: `An AWS access key id was added. ${SECRET_FIX}`,
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
    secret: true,
  },
  {
    id: 'secret.aws-secret-key',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'AWS secret access key',
    detail: `An AWS secret access key appears to be hardcoded. ${SECRET_FIX}`,
    pattern: /aws.{0,20}secret.{0,20}['"=:\s]+([A-Za-z0-9/+=]{40})\b/i,
    secret: true,
  },
  {
    id: 'secret.github-token',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'GitHub token',
    detail: `A GitHub token was added. ${SECRET_FIX}`,
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/,
    secret: true,
  },
  {
    id: 'secret.slack-token',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'Slack token',
    detail: `A Slack token was added. ${SECRET_FIX}`,
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    secret: true,
  },
  {
    id: 'secret.slack-webhook',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'Slack webhook URL',
    detail: `A Slack incoming-webhook URL lets anyone post to your channel. ${SECRET_FIX}`,
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/,
    secret: true,
  },
  {
    id: 'secret.stripe-live-key',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'Stripe live key',
    detail: `A live Stripe key was added. ${SECRET_FIX}`,
    pattern: /\b(sk|rk)_live_[A-Za-z0-9]{16,}\b/,
    secret: true,
  },
  {
    id: 'secret.google-api-key',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'Google API key',
    detail: `A Google API key was added. ${SECRET_FIX}`,
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    secret: true,
  },
  {
    id: 'secret.private-key',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'Private key',
    detail: `A private key block was added. ${SECRET_FIX}`,
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    id: 'secret.jwt',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'JSON Web Token',
    detail: `A signed JWT was added; it may grant access until it expires. ${SECRET_FIX}`,
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    secret: true,
    generic: true,
  },
  {
    id: 'secret.hardcoded-credential',
    category: FindingCategory.Secret,
    severity: FindingSeverity.Critical,
    title: 'Hardcoded credential',
    detail: `A secret-looking value is assigned in code. ${SECRET_FIX}`,
    pattern: /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|token|access[_-]?token|auth[_-]?token|password|passwd|pwd)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    secret: true,
    generic: true,
    accept: (line, m) => !PLACEHOLDER.test(m[1]) && !/process\.env|import\.meta\.env|os\.environ|getenv|\$\{|secrets\./i.test(line),
  },

  // ---- injection (warning) ----
  {
    id: 'injection.eval',
    category: FindingCategory.Injection,
    severity: FindingSeverity.Warning,
    title: 'eval / new Function',
    detail: 'Evaluating strings as code runs whatever ends up in them. Use a parser or a lookup table instead.',
    pattern: /(?<![\w.])(eval\s*\(|new\s+Function\s*\()/,
  },
  {
    id: 'injection.shell',
    category: FindingCategory.Injection,
    severity: FindingSeverity.Warning,
    title: 'Shell command built from a string',
    detail: 'Building a shell command with interpolation allows command injection. Use execFile/spawn with an argument array.',
    pattern: /\b(?:exec|execSync|spawnSync|spawn)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
  },
  {
    id: 'injection.sql',
    category: FindingCategory.Injection,
    severity: FindingSeverity.Warning,
    title: 'SQL built with string interpolation',
    detail: 'Interpolating values into SQL allows SQL injection. Use parameterized queries / placeholders.',
    pattern: /(?:`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{|["'][^"']*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*\+)/i,
  },

  // ---- crypto / TLS (warning) ----
  {
    id: 'crypto.tls-disabled',
    category: FindingCategory.Crypto,
    severity: FindingSeverity.Warning,
    title: 'TLS verification disabled',
    detail: 'Disabling certificate checks allows man-in-the-middle attacks. Fix the certificate chain instead.',
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/,
  },
  {
    id: 'crypto.weak-hash-password',
    category: FindingCategory.Crypto,
    severity: FindingSeverity.Warning,
    title: 'Weak hash used for a password',
    detail: 'MD5/SHA-1 are not suitable for passwords. Use bcrypt, scrypt or argon2.',
    pattern: /(?:createHash\s*\(\s*['"](?:md5|sha1)['"]\)|\b(?:md5|sha1)\s*\().{0,80}pass/i,
  },
  {
    id: 'crypto.insecure-random',
    category: FindingCategory.Crypto,
    severity: FindingSeverity.Warning,
    title: 'Math.random used for a token',
    detail: 'Math.random is predictable. Use crypto.randomBytes / crypto.randomUUID for tokens, ids and secrets.',
    pattern: /(?:token|secret|nonce|salt|session|otp|password|key)\w*\s*[:=][^;\n]*Math\.random\(/i,
  },

  // ---- auth (warning) ----
  {
    id: 'auth.weakened',
    category: FindingCategory.Auth,
    severity: FindingSeverity.Warning,
    title: 'Authentication weakened',
    detail: 'This change looks like it skips or disables an authentication/authorization check. Confirm it is intended and covered by tests.',
    pattern: /\bskipAuth\b|\bauth\s*:\s*false\b|\/\/\s*TODO:?\s*auth|@Public\(\)|\bisAdmin\s*=\s*true\b|\bauthorize\s*:\s*false\b|\bdisableAuth\b/,
  },

  // ---- CORS (warning) ----
  {
    id: 'cors.wildcard',
    category: FindingCategory.Cors,
    severity: FindingSeverity.Warning,
    title: 'CORS open to every origin',
    detail: 'Any website can call this API from a visitor’s browser. Restrict the allowed origins.',
    pattern: /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]|\bcors\(\s*\)/,
  },
];

/** Files the scanner never reads (generated/vendor/binary-ish). */
export const SKIP_FILE = /(^|\/)(node_modules|dist|build|\.next|out|vendor|coverage)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|woff2?|ttf|map)$/i;

/** Test data where heuristic (generic) rules produce noise; real token formats are still flagged. */
export const FIXTURE_FILE = /(^|\/)(fixtures?|__fixtures__|__snapshots__|testdata|mocks?|__mocks__)\/|\.snap$/i;

/** `.env*` files except examples/templates. */
export const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/;
export const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template|dist|defaults)$/i;
