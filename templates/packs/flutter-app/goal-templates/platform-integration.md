---
name: Platform feature
description: Camera, location, push, deep links or another native capability on iOS and Android.
icon: plug
order: 6
securityReview: always
fields:
  - id: capability
    label: Capability
    placeholder: Scan a QR code with the camera
    required: true
  - id: platforms
    label: Platforms
    placeholder: iOS and Android
  - id: denied
    label: What happens if the user says no
    placeholder: Show manual code entry instead
    multiline: true
---
1. Check which plugin the app already uses for this, or pick a maintained one and list its platform setup steps.
2. Plan the permission flow (explain → request → denied/permanently denied) and the fallback.
3. Plan Flutter Developer tasks: Dart side (service + state + UI) and platform config (Info.plist strings, AndroidManifest, Gradle/Podfile changes), each listed in the task log.
4. Plan Mobile QA: widget tests with the plugin mocked, and a debug build for each platform.
