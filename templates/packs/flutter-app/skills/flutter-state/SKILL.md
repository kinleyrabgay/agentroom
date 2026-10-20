---
name: flutter-state
description: State management and app architecture in Flutter (BLoC, Riverpod, Provider and others). Use when adding state, data loading, repositories or business logic to a Flutter app.
---
# State management in Flutter

## Use what the app already uses
- Detect it from `pubspec.yaml` and existing code: `flutter_bloc`, `riverpod`/`hooks_riverpod`, `provider`, `get_it`, `mobx`, `signals`. Follow the same patterns and folder layout. Never add a second approach.

## Layers
- **UI** widgets render state and send events/intents. No API calls or parsing in widgets.
- **State holders** (Bloc/Cubit, Notifier, ChangeNotifier) own screen state and call repositories.
- **Repositories** wrap data sources (HTTP, local DB, platform). They return domain models, not raw JSON.
- Models are immutable (`freezed`/`equatable` if the project uses them) with `copyWith`.

## Patterns by library
- **BLoC**: one event per user intent; states are immutable and exhaustive (initial, loading, success, failure). Use `buildWhen`/`listenWhen` to limit rebuilds; side effects (navigation, snackbars) in `BlocListener`.
- **Riverpod**: `Notifier`/`AsyncNotifier` for mutable state, `FutureProvider` for reads; `ref.watch` in build, `ref.read` in callbacks; use `.select` to narrow rebuilds; `autoDispose` for screen-scoped state.
- **Provider**: `ChangeNotifier` with `notifyListeners` after each change; `context.select` to narrow rebuilds.

## Async and errors
- Represent loading/error explicitly (`AsyncValue`, sealed states). Errors carry a user-facing message and are logged.
- Cancel subscriptions and timers on dispose. Guard against using `context` after `await` (`if (!context.mounted) return;`).

## Tests
- Unit-test state holders with mocked repositories (`bloc_test`, `ProviderContainer` overrides, or mocktail).
