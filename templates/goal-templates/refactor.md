---
name: Refactor
description: Improve structure without changing behaviour; tests first.
icon: shuffle
order: 3
securityReview: auto
fields:
  - id: target
    label: What to refactor
    placeholder: Split SharedFacade into auth, session and navigation services
    required: true
  - id: why
    label: Why
    placeholder: What is hard to change or understand today
    multiline: true
  - id: boundaries
    label: Out of scope
    multiline: true
---
1. Behaviour must not change. Before moving code, make sure tests cover the current behaviour; plan a task to add characterization tests where coverage is missing.
2. Split the work into small, independently reviewable steps (move, then rename, then simplify), each leaving the build and tests green.
3. Do not mix refactoring with new features or bug fixes.
4. Plan a QA task that runs the full relevant test suites and smoke-tests the affected flows.
