---
name: SaaS feature
description: A feature across UI, server actions and data, with access rules and tests.
icon: layers
order: 5
securityReview: auto
fields:
  - id: feature
    label: What should users be able to do?
    placeholder: Team admins can invite members by email with a role
    required: true
  - id: who
    label: Who can use it (plans, roles)?
    placeholder: Pro and Team plans; admins and owners only
  - id: data
    label: Data it needs
    placeholder: New invites table with email, role, token, expiresAt
    multiline: true
  - id: done
    label: Done when
    placeholder: Invite sent, accepted via link, member appears with the right role
    multiline: true
---
1. Explore the existing data layer, auth helpers and the nearest similar feature first. Reuse them.
2. Plan tasks in this order, each small enough to review:
   - Backend Developer: schema change + migration (if any), then server actions/handlers with auth, tenant and plan checks, validation and tests.
   - Frontend Developer: the pages/components, with loading, empty, error and unauthorised states.
   - E2E Tester: the main flow and the "not allowed" path in Playwright.
3. Access rules go in the server code, not only the UI. Mention every rule in the plan.
4. Mark tasks that touch auth, billing or migrations so the security review runs.
