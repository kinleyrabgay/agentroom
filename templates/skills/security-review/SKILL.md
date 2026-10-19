---
name: security-review
description: Review a code change for security vulnerabilities (OWASP-style) and record findings. Use when reviewing a diff for security, before tests or a pull request.
---
# Security review

## 1. Scope the change
- `git diff <base>` (the base commit is in your instructions) and `git diff --stat <base>`.
- List new or changed entry points: HTTP routes, GraphQL resolvers, CLI commands, message handlers, cron jobs, file uploads.
- Note new dependencies (package.json / lockfiles) and config changes.

## 2. Check, in this order
1. **Secrets**: keys, tokens, passwords, private keys or `.env` files in code, config, tests or fixtures. Anything real is critical.
2. **Injection**: SQL built with strings, shell commands with interpolation (`exec`), template injection, `eval` / `new Function`, NoSQL operators from user input.
3. **AuthN / AuthZ**: every new endpoint checks who the caller is and whether they may access *this* object (IDOR). Look for removed guards, `@Public()`, `skipAuth`, admin flags set by input.
4. **Input validation**: types, lengths, allowed values; path traversal (`../`) in file paths; SSRF in user-supplied URLs; open redirects.
5. **Output**: XSS (unescaped HTML, `dangerouslySetInnerHTML`, `innerHTML`, `[innerHTML]`), sensitive data in logs or error messages.
6. **Web**: CORS (`*` with credentials), CSRF on state-changing requests, cookie flags (HttpOnly, Secure, SameSite).
7. **Crypto**: weak hashes for passwords, `Math.random` for tokens, disabled TLS verification, hardcoded IVs/salts.
8. **Dependencies**: new packages are well known and needed; no install scripts you didn't expect; no known vulnerabilities.
9. **Data**: migrations that drop or expose data, missing tenant filters, PII handling.

## 3. Record what you find
- `security_finding` for each real issue:
  - **critical**: exploitable or a leaked credential. Must be fixed before merge.
  - **warning**: risky, needs a human look or a follow-up.
  - **info**: hardening notes.
  - Give the file and line, how it can be exploited, and the fix.
- For each critical issue, also `task_create` a bug (kind "bug", assignee the developer) with the exploit scenario and the fix as acceptance criteria.
- If an automated finding is a false positive, say why in your summary. Don't record it again.

## 4. Verdict
End with **pass**, or with the must-fix list. Don't change code and don't commit.
