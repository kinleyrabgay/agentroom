# Team packs and the skill registry (0.3 "Packs")

Implements D1 and D2 from the [platform plan](../platform-plan.md).

## Team packs (D1)

A pack is a folder:

```text
<pack>/
├── pack.json               # name, title, description, version, stacks[], detect{files, packageDeps, pubspecDeps}
├── bots/<NN>-<id>/bot.md   # copied to .agentroom/bots/
├── skills/<name>/SKILL.md  # copied to .agentroom/skills/ (plus any extra files)
├── goal-templates/*.md     # copied to .agentroom/goal-templates/
└── settings.partial.json   # merged into .agentroom/settings.json (two levels: section.key)
```

Built in (`templates/packs/`, never copied by `init`):

| Pack | Bots | Skills | Goal templates | Settings |
|---|---|---|---|---|
| `nextjs-saas` | Frontend Developer, Backend Developer, E2E Tester | nextjs-app-router, nextjs-data-and-api, saas-auth-billing, db-migrations, e2e-playwright, web-accessibility | SaaS feature, New page | sensitive paths: middleware, webhooks, auth, Prisma/Drizzle, next.config |
| `flutter-app` | Flutter Developer, Mobile QA | flutter-widgets, flutter-state, dart-testing, flutter-platform | New screen, Platform feature | sensitive paths: Gradle, keystores, Info.plist, entitlements, Firebase config |

Detection: `nextjs-saas` when `next.config.*` exists or package.json depends on `next`; `flutter-app` when pubspec.yaml depends on `flutter`.

### CLI

```bash
agentroom init --pack nextjs-saas   # scaffold + install; plain init prints a tip when a pack fits
agentroom pack list                 # built-ins, which fit this repo, what's installed (and edited)
agentroom pack add <name|folder>
agentroom pack update [name]        # all installed packs when no name
agentroom pack remove <name>
```

### Updates never clobber edits

- `runs/packs.lock.json`: per pack, the version, origin (`builtin` or a folder path), sha256 of each file as installed, and the settings it shipped.
- `runs/packs/<name>/`: an exact copy of the files the installed version shipped, used as the merge base.
- Per file on update: create if missing (unless you deleted it after install, which is respected); take the new version if yours is untouched; keep yours if the pack didn't change it; otherwise a line-based three-way merge (`src/core/packs/merge3.ts`). On conflict your file stays and the pack's version is written next to it as `<file>.pack-incoming` (not picked up as a bot, skill or template).
- A file that existed before the pack is never claimed: first install with a different file is a conflict, and `remove` never deletes it.
- Files dropped by a new version are removed only if untouched.
- Settings: lists merge item by item (your additions stay; items the pack dropped are removed only if they came from the pack); scalar values you changed are kept (`settings.kept`), untouched ones (still the default or the pack's previous value) are updated.
- `remove`: deletes untouched files, keeps edited ones, unassigns removed skills from remaining bots, leaves settings as they are.
- Installing a goal template into a project that used the built-in set copies the built-ins first, so they don't disappear.

Note: the lock and base live in `runs/` (local). A teammate who pulls a pack-installed repo has no base; their first `pack update` treats differing files as conflicts (safe, never overwrites).

### UI

Settings → **Packs**: one card per pack (Fits this repo, Installed x.y, N edited, Local folder), contents and stacks, Install / Update to x.y (version compare) / Reapply / Remove (confirm). A warning callout lists files to merge by hand after an update.

## Skill registry (D2)

### Sources (team settings: `registries.sources`)

| Kind | How it works |
|---|---|
| `index` | An AgentRoom-format `index.json` over HTTPS: `{ version: 1, skills: [{ name, description, version, author?, tags?, url, sha256 }] }`. Tarball URL may be relative to the index. Private registry = another index URL. |
| `skills-sh` | Search via `https://skills.sh/api/search?q=` (undocumented but public; returns `source` owner/repo + `skillId`). Files come from GitHub: commit pinned via the API, tree listed, skill folder found by folder name or frontmatter `name`, files fetched from raw.githubusercontent.com at that commit. `GITHUB_TOKEN` is used if set (rate limits). |

Defaults: AgentRoom index (placeholder `kinleyrabgay/agentroom-registry`, **disabled** until published) and skills.sh (enabled).

Agensi: no public API found, so it isn't a source. Skills bought there (or anywhere) are imported as a downloaded `SKILL.md`, `.zip` or `.tgz` (Browse → Import, or `agentroom skill install ./file.zip`).

### Install = preview, then install that preview

1. `preview(ref)` / upload / local path fetches and unpacks into memory. Nothing is written. Archives are read without dependencies (`src/server/registry/archive.ts`): tar/tar.gz (links and devices refused) and zip (symlinks refused); path traversal and absolute paths refused; ≤200 files, ≤1 MB each, ≤5 MB total; https only.
2. The preview shows the full SKILL.md, every text file (scripts expanded by default), sizes, the sha256 (and whether it matched the registry index), prompt-injection matches from the existing scanner, a "N scripts included" warning, binary files, and whether it replaces an existing skill (and if that one has local edits).
3. `install(previewId)` writes exactly what was previewed to `.agentroom/skills/<name>/` with mode 0644 (nothing executable, nothing run). Replacing needs explicit overwrite. Previews expire after 30 minutes and install once.
4. Provenance in the SKILL.md frontmatter: `source` (e.g. `skills.sh:owner/repo/skill@<sha12>`, `acme:lint-fix`, `https://…`, `file:x.zip`), `version` (unless the skill declares its own) and `sha256` of the installed files, so later edits show as **Edited here**. Editing a skill in the UI keeps these keys.
5. Index registries: a hash mismatch between download and index aborts ("Not installed").

Every install is in the audit log (kind `settings`) with the source and hash.

### Update

`agentroom skill update <name>` or **Check for update** in the skill editor: re-resolves from `source`, compares content, and opens the same preview to replace.

### Publish (no network)

```bash
agentroom skill validate <name|folder>
agentroom skill publish <name|folder> --release 1.0.0 --out dist-skills --base-url https://skills.example.dev [--author "Name"]
```

Validation: `name` lowercase slug, description 20–1024 chars, non-empty body, no secret-looking files, injection matches as warnings. Publishing writes a deterministic `<name>-<version>.tgz` and `<name>-<version>.index-entry.json` (with sha256) to add to a registry's index.json. Install provenance keys are stripped from the published copy. The folder itself is what skills.sh (via a GitHub repo) and marketplaces like Agensi accept.

### UI

- Sidebar Skills → **Browse skills…**: dialog with Registries (debounced search across enabled sources; installs count, version, "In library") and Import (drop a file or enter a `github:` / `skills-sh:` / https reference). Right pane: the preview; when there are warnings or it replaces a skill, an "I've read it" checkbox gates Install.
- Skill editor: "Installed from … · version · Edited here · Check for update".
- Settings → Packs → **Skill registries**: list with on/off and remove, add an index by name + URL (saved with the Team / Just me switch like other settings).

## API

| Route | |
|---|---|
| `GET /packs` | `PackView[]` |
| `POST /packs/:name/install` · `POST /packs/:name/update` · `DELETE /packs/:name` | `PackResult` |
| `GET /registry/sources` · `GET /registry/installed` | |
| `GET /registry/search?q=` | `{ results, errors }` |
| `POST /registry/preview {ref}` · `POST /registry/upload {name, data(base64)}` | `SkillPreview` |
| `POST /registry/install {id, overwrite}` | |
| `POST /registry/skills/:name/check` | `{ preview, changed }` |

## Files

- Core: `src/core/packs/{packs,merge3}.ts`
- Server: `src/server/registry/{archive,bundle,client,registry.service}.ts`, `src/server/http/routes/packs.routes.ts`
- CLI: `src/cli/commands/pack.ts`, `skill.ts` (install/update/validate/publish), `init.ts` (`--pack`, suggestion)
- Shared: `src/shared/types/packs.ts`, `SettingsSchema.registries`
- Web: `web/features/packs/`, `web/features/skills/components/{browse-skills-dialog,skill-origin}.tsx`
- Packs: `templates/packs/{nextjs-saas,flutter-app}/`
- Tests: `test/packs.test.ts`, `test/registry.test.ts`
