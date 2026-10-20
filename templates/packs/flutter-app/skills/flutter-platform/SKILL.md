---
name: flutter-platform
description: Android and iOS configuration for Flutter apps: permissions, plugins, build settings, deep links and push. Use when a change touches android/, ios/, native plugins or platform channels.
---
# Platform configuration (Android and iOS)

Platform files are sensitive: every change here is reviewed. Describe each change in the task log.

## Permissions
- Request at the moment of use, with an explanation screen first; handle "denied" and "permanently denied" (open settings).
- iOS: add the matching `NS…UsageDescription` strings to `ios/Runner/Info.plist` with a clear reason.
- Android: declare in `AndroidManifest.xml`; use the minimal permission (e.g. coarse location if enough); follow the target SDK's rules (notification permission on Android 13+, photo picker instead of storage).

## Plugins and native code
- Prefer maintained packages. After adding one, check its platform setup steps (min SDK, iOS deployment target, Podfile, Gradle).
- Platform channels: define method names in one place, handle `PlatformException`, and test with a mocked channel.

## Builds
- Don't change `applicationId`/bundle identifier, signing configs, version codes or deployment targets unless the task says so.
- Never commit keystores, `key.properties`, `google-services.json`/`GoogleService-Info.plist` with real values, or API keys. Ask a human for credentials.

## Deep links and push
- Deep links: App Links (Android `intent-filter` with `autoVerify`) and Universal Links (associated domains) must match the router's routes.
- Push: request permission politely, handle foreground/background/terminated messages, and never put secrets in payloads.

## Verify
- `flutter build apk --debug` and `flutter build ios --no-codesign` (when on macOS) still succeed after platform changes.
