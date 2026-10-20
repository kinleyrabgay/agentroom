---
name: New screen
description: A Flutter screen with its states, navigation, and widget tests.
icon: smartphone
order: 5
securityReview: off
fields:
  - id: screen
    label: Screen and where it's reached from
    placeholder: Order history, from the profile tab
    required: true
  - id: content
    label: What it shows and does
    multiline: true
    required: true
  - id: design
    label: Design or reference
    placeholder: Figma link, screenshot, or "like the favourites screen"
---
1. Find the closest existing screen and follow its folder layout, state management, routing and theming.
2. Plan a Flutter Developer task for data (repository + state holder + tests) and one for the UI (loading, empty, error and content states, text scaling, small/large screens).
3. Plan a Mobile QA task: widget tests for each state and an integration test for the main path if the app has integration tests.
