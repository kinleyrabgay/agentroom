/**
 * Adaptive Cards for Microsoft Teams.
 *
 * Two different payloads:
 * - Workflow (Power Automate) webhooks take a message with an Adaptive Card attachment.
 * - Outgoing-webhook replies are a Bot Framework message (text or the same attachment shape).
 * Cards only use Action.OpenUrl: webhook cards can't call back (no Action.Submit).
 */

export interface CardFact {
  title: string;
  value: string;
}

export interface CardSpec {
  title: string;
  /** Short line under the title (muted). */
  subtitle?: string;
  /** Markdown-ish body (Teams renders a subset). */
  text?: string;
  facts?: CardFact[];
  /** Commands the reader can type back, shown as monospace hints. */
  hints?: string[];
  links?: { title: string; url: string }[];
  tone?: 'default' | 'good' | 'warning' | 'attention' | 'accent';
}

const MAX_TEXT = 3500;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The Adaptive Card JSON (schema 1.4, what Teams supports in webhooks). */
export function adaptiveCard(spec: CardSpec): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    { type: 'TextBlock', text: clip(spec.title, 200), weight: 'Bolder', size: 'Medium', wrap: true, ...(spec.tone && spec.tone !== 'default' ? { color: spec.tone } : {}) },
  ];
  if (spec.subtitle) body.push({ type: 'TextBlock', text: clip(spec.subtitle, 300), isSubtle: true, spacing: 'None', wrap: true, size: 'Small' });
  if (spec.text) body.push({ type: 'TextBlock', text: clip(spec.text, MAX_TEXT), wrap: true });
  if (spec.facts?.length) body.push({ type: 'FactSet', facts: spec.facts.slice(0, 10).map((f) => ({ title: clip(f.title, 60), value: clip(f.value, 300) })) });
  if (spec.hints?.length) {
    body.push({
      type: 'TextBlock',
      text: spec.hints.map((h) => `\`${h}\``).join('  ·  '),
      wrap: true,
      isSubtle: true,
      size: 'Small',
      fontType: 'Monospace',
      spacing: 'Medium',
    });
  }
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body,
    ...(spec.links?.length ? { actions: spec.links.slice(0, 4).map((l) => ({ type: 'Action.OpenUrl', title: clip(l.title, 40), url: l.url })) } : {}),
  };
}

/** Body for a Workflows / incoming webhook POST. */
export function workflowMessage(spec: CardSpec): Record<string, unknown> {
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: adaptiveCard(spec) }],
  };
}

/** A plain line of text as a card (digests, trigger notifications). */
export function teamsTextMessage(text: string): Record<string, unknown> {
  const [first = '', ...rest] = text.split('\n');
  return workflowMessage({ title: first, ...(rest.join('\n').trim() ? { text: rest.join('\n').trim() } : {}) });
}

/** Synchronous reply to an outgoing webhook (must be returned within 5 seconds). */
export function outgoingReply(spec: CardSpec): Record<string, unknown> {
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: adaptiveCard(spec) }],
  };
}
