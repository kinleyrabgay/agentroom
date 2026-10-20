---
name: New page
description: A new route in the App Router with its states, metadata and a browser check.
icon: file-plus
order: 6
securityReview: off
fields:
  - id: route
    label: Route
    placeholder: /settings/notifications
    required: true
  - id: content
    label: What the page shows and does
    multiline: true
    required: true
  - id: design
    label: Design or reference
    placeholder: Figma link, screenshot, or "like /settings/profile"
---
1. Find the closest existing page and follow its layout, components and data loading.
2. Plan one Frontend Developer task for the route (page, loading/error states, metadata) and, if it needs data or mutations, a Backend Developer task before it.
3. Plan a check in the in-app browser at desktop and 375px widths, keyboard only, and dark mode if the app has one.
