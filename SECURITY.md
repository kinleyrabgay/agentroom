# Security Policy

AgentRoom runs AI agents that can edit files and run commands on your machine, so we take security
reports seriously.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

**Please don't open a public issue.** Report privately through
[GitHub Security Advisories](https://github.com/kinleyrabgay/agentroom/security/advisories/new).

Include:

- What the issue is and what an attacker could do with it
- Steps to reproduce, or a proof of concept
- Affected version or commit
- Any suggested fix

You'll get an acknowledgement within 72 hours and an initial assessment within 7 days. We'll keep you
updated while we fix it and credit you in the release notes unless you'd rather stay anonymous.

## Scope

In scope:

- Bypassing approvals, the permission gate or `alwaysAsk`
- Accessing the server without the per-run token, or from another origin or host
- The preview proxy or bridge script being used to reach or run code on unintended sites
- Leaking credentials, tokens or local secrets

Out of scope:

- Actions a bot takes after you approved them, or while `permissionMode` is `auto`
- Issues in third-party dependencies with no AgentRoom-specific impact (report those upstream)
- Attacks that need prior local access to your user account
