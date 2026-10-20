---
name: dart-testing
description: Unit, widget, golden and integration tests for Flutter and Dart. Use when adding tests, reproducing a bug with a failing test, or verifying a screen's states.
---
# Testing Flutter apps

## Kinds of tests
- **Unit** (`test/`): pure Dart logic, state holders, repositories with mocks.
- **Widget** (`test/`, `testWidgets`): a screen or widget in each state; pump with the app's theme, localisation and providers/blocs overridden.
- **Golden**: pixel snapshots of key widgets, if the project already uses them (`matchesGoldenFile`, alchemist or golden_toolkit). Update goldens only on purpose and say so.
- **Integration** (`integration_test/`): the main user flow on a device/emulator.

## Writing good tests
- Find widgets by key, text or semantics label the way a user would see them; avoid relying on widget tree internals.
- `await tester.pumpAndSettle()` after interactions; for endless animations pump a duration instead.
- Mock network and platform channels; tests never hit real servers or real accounts.
- Cover: loading, empty, error with retry, success; long text and large text scale; small and large screen sizes.
- Bug fixes start with a failing test that reproduces the bug.

## Running
- `flutter test path/to/file_test.dart` for what you touched, then `flutter test`.
- `flutter analyze` must be clean. Integration tests: `flutter test integration_test` only when a device is available.
