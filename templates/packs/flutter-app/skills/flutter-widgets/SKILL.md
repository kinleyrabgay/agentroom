---
name: flutter-widgets
description: Build Flutter screens and widgets that follow the app's theme, adapt to screen sizes and stay fast. Use when adding or changing UI in a Flutter app.
---
# Flutter widgets and layout

## Before you start
- Read `pubspec.yaml` (Flutter/Dart versions, packages) and `analysis_options.yaml`.
- Find a similar screen and reuse its structure, routing (go_router, auto_route, Navigator) and shared widgets.

## Building UI
- Theme first: colours from `Theme.of(context).colorScheme`, text from `textTheme`, spacing from the app's constants. No hard-coded colours.
- Split big `build` methods into small widgets (classes, not helper methods returning widgets) so Flutter can rebuild less.
- Use `const` constructors wherever possible.
- Lists: `ListView.builder`/`SliverList` for long or unbounded lists; never a `Column` of hundreds of children.
- Layout: `LayoutBuilder`/`MediaQuery.sizeOf` for breakpoints; avoid fixed heights for text containers; wrap scrollable content in `SafeArea`.
- Text scaling and localisation: no truncation at 1.3× text; strings from the app's l10n files, not literals.

## States every screen has
- Loading, empty, error (with retry), and content. Offline if the app supports it.

## Accessibility
- Tap targets ≥ 48×48. `Semantics`/`tooltip` for icon-only buttons. Sufficient contrast in light and dark themes.

## Performance
- No network or heavy computation inside `build`. Dispose controllers, streams and animations. Use `RepaintBoundary` only when profiling shows it helps.

## Verify
- `flutter analyze` clean, `dart format` applied, widget tests for each state.
