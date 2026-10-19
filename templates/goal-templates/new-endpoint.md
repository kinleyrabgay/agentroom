---
name: New endpoint
description: Route, validation, data access, tests and docs.
icon: plug
order: 2
securityReview: always
fields:
  - id: endpoint
    label: Method and path
    placeholder: POST /api/v1/opportunities/:id/archive
    required: true
  - id: behaviour
    label: What it does
    placeholder: Inputs, outputs, status codes, who may call it
    multiline: true
    required: true
  - id: constraints
    label: Constraints
    placeholder: Auth, rate limits, idempotency, backwards compatibility
    multiline: true
---
1. Follow the existing route, validation and error-handling patterns in this codebase; find a similar endpoint and mirror it.
2. Validate all input at the boundary and check authorization before doing any work.
3. Plan dev tasks for: the route and validation, the data access, and tests (happy path, validation errors, unauthorized).
4. Update API docs or OpenAPI specs if the project has them.
5. Plan a QA task that calls the endpoint with valid, invalid and unauthorized requests.
