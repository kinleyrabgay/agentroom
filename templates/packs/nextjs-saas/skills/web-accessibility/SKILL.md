---
name: web-accessibility
description: Accessibility checklist for web UI (WCAG 2.2 AA). Use when building or reviewing pages, forms, dialogs, menus or any interactive component.
---
# Web accessibility

## Structure
- One `h1` per page; headings in order. Landmarks: `header`, `nav`, `main`, `footer`.
- Use real elements: `button` for actions, `a` for navigation, `label` for inputs. Avoid clickable `div`s.

## Forms
- Every input has a visible label (or `aria-label` when the design truly has none).
- Errors are text next to the field, linked with `aria-describedby`, and announced; don't rely on colour alone.
- Required fields are marked in text, not only with an asterisk colour.

## Keyboard and focus
- Everything works with Tab, Shift+Tab, Enter, Space and Escape. Focus is always visible.
- Dialogs trap focus, close on Escape and return focus to the trigger. Use the UI library's dialog/menu primitives where available.
- No keyboard traps; logical tab order follows the visual order.

## Visuals
- Text contrast ≥ 4.5:1 (3:1 for large text and UI parts). Check dark mode too.
- Respect `prefers-reduced-motion`. Don't convey meaning by colour alone.
- Images have meaningful `alt` text, or `alt=""` when decorative.

## Check
- Tab through the page in the in-app browser. Zoom to 200%. Check at 375px width.
- If the project has axe or eslint-plugin-jsx-a11y, run it and fix what it finds.
