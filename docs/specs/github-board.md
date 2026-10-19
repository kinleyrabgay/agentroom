# GitHub Board

Mirror a GitHub Project (v2) inside AgentRoom, so the team pulls real work from it. A card, or several,
can be handed to the Team Lead, which starts a goal run (plan → review → build → test → report).

GitHub stays the source of truth. AgentRoom **reads** the board. The only thing it **writes** is
assigning yourself to a card or unassigning yourself.

## Setup

- Workspace → **GitHub**. Paste a project URL: `https://github.com/orgs/<org>/projects/<n>` or
  `https://github.com/users/<user>/projects/<n>`.
- AgentRoom checks the URL, shows the project's title and columns, then saves it.
- All calls go through the user's `gh` CLI (GraphQL via `gh api graphql`), so AgentRoom stores no tokens.
- If the `project` scope is missing, the UI shows `gh auth refresh -s project`.

## Data and caching

The two kinds of data are treated differently.

### Columns: configuration, cached, rarely re-fetched

The Status field's options are the board's columns.

- Stored as JSON in `.agentroom/github/project.json`. It's **committed**, so teammates get the same
  layout without fetching it themselves.
- Contents: `url`, `owner`, `ownerType` (`org` | `user`), `number`, `title`, `projectId`,
  `statusField` (`{ id, name }`), `columns` (`[{ id, name, color? }]` in GitHub order),
  `hiddenColumns` (`string[]`, set by the user), `columnsSyncedAt`.
- Columns are re-synced **only** when:
  1. the user presses **Sync columns** in GitHub settings, or
  2. an item comes back with a status that isn't in the cached columns (the board was changed on
     GitHub), or
  3. the cache is more than 24 h old (a once-a-day safety net, checked lazily when the view opens).

### Items (cards): live data, cached for speed

- Cached in `.agentroom/runs/github-items.json` (not committed: it's per user and changes often).
- On open, the board renders from the cache **instantly**, then refreshes in the background.
- Refreshes happen:
  - when the GitHub view is opened,
  - every **60 s, only while the view is visible** (`document.visibilityState === 'visible'` and the
    view is mounted),
  - when the user presses **Refresh**.
- No background polling when nobody is looking.
- Offline, or with no auth, the board shows the last known state with a "Last updated <time> ·
  couldn't refresh: <reason>" notice.
- Items are fetched with pagination (100 per page). Per card: id, content type (Issue / PR /
  Draft), repo, number, title, url, state, Status option id, Priority, iteration/sprint, labels,
  assignees (login + avatar), linked PRs, updatedAt. The body is loaded lazily when a card's details
  open.

### Cost

GitHub's API limit is not the concern: a 38-card board costs about 1–2 points per fetch out of
5,000/hour. The real costs are:

- **Latency:** each `gh` call starts a process (about 1–2 s). Hence the cache-first rendering and a
  single GraphQL query per refresh.
- **Noise:** polling while nobody is looking. Hence refreshing only while the view is visible.
- **Offline / no auth:** the board still shows the last known state.

## Board UI

- The same Status columns in GitHub order, plus "No status". Hidden columns are configurable, and
  empty columns can be collapsed.
- Card: `repo#123`, title, labels, priority, sprint, assignee avatars, linked-PR icon.
- Filters: search, Mine / Unassigned / Anyone, label, sprint.
- Card detail panel: issue body (markdown), labels, assignees, linked PRs, "Open on GitHub",
  **Assign me / Unassign me**.

## Writes to GitHub (only these)

- Assign me / Unassign me (`addAssigneesToAssignable` / `removeAssigneesFromAssignable` with the
  viewer's id). The card updates optimistically and rolls back on error.

## Hand-off to the team

- Cards can be multi-selected (checkbox on hover, shift-click for a range). A selection bar shows
  "N cards → Hand off".
- The composer:
  - `/` suggests bot names (`/team-lead` first, the default target).
  - `@` suggests repo files (markdown first, from `git ls-files`).
  - A links field takes PR links and URLs.
  - Free-text notes.
- Sending creates a **goal** whose brief contains, for each card: title, url, labels, body, and the
  last few comments (fetched fresh), plus the user's note, the referenced files (as paths for the
  bots to read) and the links.
- The goal records its sources (`sources: [{ type: 'github', url, number, title, itemId }]`). The
  Board shows them as linked chips, and the GitHub board marks cards that belong to an active goal.
