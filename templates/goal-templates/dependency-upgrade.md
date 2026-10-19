---
name: Dependency upgrade
description: Read the changelog, upgrade, fix what breaks.
icon: package
order: 4
securityReview: always
fields:
  - id: package
    label: Package and target version
    placeholder: "@angular/core 20 → 21"
    required: true
  - id: notes
    label: Known concerns
    placeholder: Deprecated APIs we use, peer dependencies, release notes link
    multiline: true
---
1. Read the package's changelog and migration guide between the current and target versions; list the breaking changes that affect this codebase.
2. Upgrade with the project's own package manager and lockfile; upgrade peer dependencies together.
3. Plan dev tasks per breaking change, then a task to run build, lint and the full test suite.
4. Never upgrade unrelated packages in the same goal.
5. Plan a QA task that smoke-tests the main user flows in the in-app browser.
