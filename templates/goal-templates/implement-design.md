---
name: Implement design
description: Build a screen from a Figma frame or a design image; Verify scores how closely it matches.
icon: palette
order: 6
securityReview: auto
design: true
fields:
  - id: figma
    label: Figma frame link
    placeholder: https://www.figma.com/design/AbC123/App?node-id=12-345
  - id: image
    label: Or a design image
    image: true
  - id: page
    label: Page to build or change
    placeholder: /pricing
    required: true
  - id: size
    label: Frame size
    placeholder: 1440x900 (read from Figma when empty)
  - id: notes
    label: Notes
    placeholder: Reuse the existing Card and Button components; data comes from /api/plans
    multiline: true
---
Implement the design as production UI, using the project's existing components, tokens and styles rather than hard-coded values.

1. Read the design: with Figma MCP tools, fetch the frame's design context (layout, text, colours, spacing) for the node in the link; otherwise study the attached design image.
2. Plan dev tasks per section of the screen (layout first, then content, then states). Reuse components; note any missing ones as their own task.
3. Match spacing, typography and colours to the design system tokens closest to the design; don't invent new ones without saying so.
4. Plan a QA task that opens the page in the in-app browser at the frame's size and compares it with the design.

The Verify step renders the page at the frame size and scores the match against the design (structure, pixels, proportions). A low score pauses the goal so you can look before the PR.
