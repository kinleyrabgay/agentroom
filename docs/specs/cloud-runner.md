# Cloud runner and relay (E3): design

Status: **design only** (see Revisions below). Nothing here is built or deployed; no external services are called by AgentRoom today. Schedules and triggers already carry `runner: 'local' | 'cloud'` (`RunnerSchema` in `src/shared/schemas.ts`); only `local` runs.

## Goals

1. Schedules, triggers and goals keep running with the laptop closed.
2. Teammates reach a room over the internet with a stable URL and real sign-in, without the owner's machine or a quick tunnel (the D3 team room becomes a hosted room).
3. Phone approvals and Teams intake go through one authenticated relay instead of per-feature tunnels.
4. Same product, same UI, same `.agentroom/` config: the cloud is just another place the server runs.

Non-goals for v1: running untrusted third-party code for others, a hosted LLM (customers bring their own key), Windows sandboxes.

## Architecture

```
 Browser / phone / Teams ──HTTPS/WSS──▶ Relay (stateless edge, auth, routing)
                                          │  per-project authenticated WSS tunnel
             ┌────────────────────────────┴───────────────────────────┐
             ▼                                                        ▼
   Owner's laptop (agentroom start)                      Cloud runner (sandbox VM per project)
   - connects out to relay (optional)                    - same AgentRoom server, headless
   - executes local runner items                         - clone via GitHub App, worktrees on a volume
                                                         - executes cloud runner items, 24/7
                       Control plane (API + Postgres): orgs, projects, members, runner state,
                       encrypted secrets (KMS), spend ledger mirror, audit mirror, billing
```

### Relay

- Stateless WebSocket broker at `rooms.agentroom.dev` (name TBD). Each AgentRoom server (laptop or cloud) dials **out** and holds one multiplexed WSS connection; nothing listens on the customer's machine.
- Browsers authenticate to the relay (OIDC: GitHub/Google/Microsoft; SSO/SAML for Team), get a short-lived room token, and the relay forwards HTTP/WS frames to the server over the tunnel.
- The relay enforces the **same role policy** as D3 (`memberMayCall`/`memberMaySend` ported as a shared package) as defence in depth; the server still enforces it too.
- Phone approvals and Teams outgoing webhooks terminate at the relay (stable URL, HMAC verified there) and are forwarded as typed messages.

### Cloud runner

- One sandbox VM per project (not per goal): repo checkout + `~/.agentroom/worktrees` on a persistent volume, AgentRoom server headless, no inbound ports (talks only to the relay).
- Started on demand (schedule due, trigger fired, someone opens the room), stopped after idle (e.g. 15 min with no runs or viewers) to keep costs near zero.
- Clone and push with a **GitHub App** installation token (per-repo, short-lived, minimal scopes: contents, pull requests, metadata). No personal tokens in the cloud.
- Model access with the **customer's own Anthropic API key**, stored encrypted (envelope encryption, per-project data key, KMS master key), injected only into that project's VM. A personal Claude subscription login is never used in the cloud.
- Other secrets (Sentry, MCP `${secret:NAME}`, Teams webhook) live in the same per-project vault and are mounted as the existing `runs/secrets.json` shape, so the server code doesn't change.
- Egress allow-list by default: Anthropic API, GitHub, package registries, configured MCP/Sentry hosts; everything else needs an explicit project setting.

### Spend and audit

- Server-side caps: the control plane mirrors the ledger (`runs/ledger.jsonl` rows) and refuses to start runs past the project's daily/monthly cap, independently of the in-app budgets.
- Audit mirror: every audit entry is streamed to the control plane (append-only, retained per plan), so an owner can see what the cloud runner did even if the VM is gone.

## API between a local server and the relay

All messages over one WSS connection, JSON frames with `id` for request/response.

| Direction | Message | Purpose |
|---|---|---|
| server → relay | `hello { projectId, serverVersion, capabilities, runner: 'local' \| 'cloud' }` | Register (authenticated with a project credential issued at link time) |
| relay → server | `http.request { id, method, path, headers, body, principal }` / server → relay `http.response` | Proxied API call; `principal` = verified identity + role from the relay |
| both | `ws.open { stream, principal }`, `ws.frame`, `ws.close` | Proxied live channel per browser tab |
| relay → server | `intake { source: 'teams' \| 'phone', payload, principal }` | Verified inbound events |
| server → relay | `ledger.append { rows }`, `audit.append { entries }` | Mirrors for caps and audit |
| relay → server | `run.request { itemId, kind: 'schedule' \| 'trigger' }` | Control plane asks the cloud runner to execute an item |
| server → relay | `heartbeat { busy, viewers, nextRunAt }` | Idle detection for stop/start |

Linking: `agentroom cloud link` opens a browser device-code flow, creates the project in the control plane, and stores a project credential in `runs/secrets.json`. `agentroom cloud unlink` revokes it.

## Sandbox provider options

Requirements: strong isolation (microVM or gVisor-class), long-running processes (hours), persistent volume per project, fast stop/start, outbound network control, an API for lifecycle, reasonable per-second pricing, and EU/US regions. Prices and limits change often; re-check before committing.

| Option | Isolation | Long sessions + volume | Lifecycle API | Ops burden | Notes |
|---|---|---|---|---|---|
| **E2B** | Firecracker microVMs | Sandboxes built for agents; session length limited by plan; pause/resume available | Simple SDK | Low | Great for short, ephemeral sandboxes; less natural for a per-project VM that lives for months |
| **Modal** | gVisor containers | Sandboxes with timeouts; volumes available | Python-first SDK | Low | Excellent burst compute; the long-lived server pattern fits less well |
| **Fly Machines** | Firecracker microVMs | Yes: machines + volumes, stop/start in seconds | REST API | Medium | Closest to "a small VM per project"; regions worldwide; we own the image |
| **Daytona** | Containers/VMs for dev environments and agent sandboxes | Yes, persistent workspaces | API/SDK | Low–medium | Designed for this use case; check isolation model and pricing at decision time |
| **Own Firecracker** (bare metal) | Firecracker microVMs | Yes | Build our own | High | Best unit cost and control at scale; months of infra work |

**Recommendation:** start on **Fly Machines** behind a `SandboxProvider` interface (`create, start, stop, exec, attachVolume, destroy, logs`): it matches the one-VM-per-project model with persistent volumes and fast stop/start, without building virtualization. Keep **E2B** as the second adapter for ephemeral per-goal sandboxes (e.g. running untrusted PR code in review). Revisit own Firecracker only when sandbox spend is a large share of revenue.

## Pricing tiers (proposal)

| Tier | For | Includes |
|---|---|---|
| **Free (open source)** | Individuals | Everything local, including the LAN/tunnel team room |
| **Pro** (per seat / month) | Solo devs who want 24/7 | Cloud runner for 1–3 projects with included sandbox hours, hosted relay (stable URL, phone and Teams without a tunnel), cloud audit mirror |
| **Team** (per seat / month) | Small teams | Hosted rooms with sign-in (GitHub/Google/Microsoft), roles, more projects and hours, shared spend caps, private pack/skill registry |
| **Enterprise** | Companies | SSO/SAML + SCIM, audit export/retention, region pinning, VPC egress, custom limits, support |

Model usage is always billed by Anthropic on the customer's own key; we bill seats + sandbox hours above the included amount.

## Phased rollout

1. **Relay alpha**: hosted relay + `agentroom cloud link`; replaces quick tunnels for the team room, phone approvals and Teams intake. No cloud runner yet. (Lowest risk, immediate value.)
2. **Runner beta**: Fly-backed runner for schedules and triggers marked `runner: 'cloud'`; GitHub App; BYO key vault; server-side caps; audit mirror. Invite-only.
3. **Hosted rooms GA**: rooms work entirely in the cloud (owner's laptop optional); billing; Pro and Team tiers.
4. **Enterprise**: SSO/SCIM, region pinning, egress controls, compliance work (SOC 2 Type I → II).

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Relay compromise exposes rooms | Relay holds no long-lived secrets; servers authenticate per project; payloads can be end-to-end signed by the server; least-privilege service accounts; audited deploys |
| Cross-tenant escape from a sandbox | MicroVM isolation, one project per VM, no shared volumes, no metadata service access, egress allow-list |
| Stolen API key / GitHub token | Envelope encryption with KMS, keys only in the owning VM's memory, GitHub App short-lived tokens, rotation and revoke in the dashboard |
| Prompt injection makes bots exfiltrate code or secrets | Existing injection guard + approvals; egress allow-list; secrets never in prompts; outbound writes still need approval or an explicit rule |
| Runaway spend | Server-side caps independent of the VM; idle stop; per-run budget; alerts at 80% |
| Member link leaked | Same as D3: expiring, revocable, role-scoped; hosted rooms add real sign-in |
| Supply-chain attack via packages installed in the sandbox | Dependency guard already flags typosquats; sandbox is disposable; volume snapshots for rollback |
| Abuse of free relay (crypto mining, proxying) | Relay forwards only AgentRoom protocol frames; rate limits; runner is paid-only |
| Data residency | Region-pinned projects (Enterprise); audit/ledger mirrors stored in the project's region |

## Revisions (2026-10-23)

Changes to the plan above, after 0.0.4 and a study of PandaCode's remote access (`docs/research/pandacode.md`):

1. **Phase 0, before any hosting: run it on your own server.** `agentroom start` headless on a VPS or always-on dev box, reachable over Tailscale (bind to the tailnet address, or behind `tailscale serve`, with the same member links and roles as the local-network listener). Needs a headless start mode and a Linux background service (`daemon` is macOS only today). Proves demand for "always on" without running infrastructure.
2. **The relay is end-to-end encrypted.** Each device has an X25519 key; each pair derives a key with HKDF and sends XChaCha20-Poly1305 frames, so the relay sees device ids and ciphertext only. Devices are pinned after comparing a short fingerprint; a changed key makes the device untrusted again. Requests carry a timestamp and nonce against replay, checked after the trust check. Caveat: if the relay also serves the web UI it could change that code, so full E2E holds only for a UI served from elsewhere (the installed PWA or a desktop shell).
3. **Two kinds of cloud compute behind one `SandboxProvider`** (`create, start, stop, exec, attachVolume, destroy, logs`):
   - a long-lived machine per project (this spec's runner), for schedules, triggers and hosted rooms;
   - short-lived sandboxes per task: parallel builders get a sandbox and a branch each (replacing the non-overlapping `files` rule with a merge), untrusted PR review, and proof recordings.
4. **Re-check providers at decision time.** Add Cloudflare Sandbox, AWS and Vercel Sandbox to the comparison alongside Fly Machines, E2B, Modal and Daytona; run the two-week spike on two of them.
5. **Continue in cloud / bring it back.** Push a goal's branch and state to the runner and continue there; the goal stays one row in the local UI, mirroring the remote run. The reverse brings it home.
6. **Model access in the cloud is an API key only.** A Claude subscription login can't be used on cloud machines, so cloud runs are billed at API rates; caps and the local-first default matter for that reason, and the UI should say so before a run moves to the cloud.

Revised order: phase 0 (own server + Tailscale) → relay alpha with E2E → `SandboxProvider` and per-task sandboxes → per-project cloud runner → hosted rooms, billing and Continue in cloud.

## Open questions

1. Hosted relay domain and whether to allow self-hosting the relay (likely yes, for Enterprise).
2. Fly Machines vs Daytona after a 2-week spike on cold start, volume performance and cost per project-month.
3. Whether the laptop and the cloud runner can be active for the same project at once (proposal: yes; each executes only items assigned to its runner, as owner-gating already does for team automation).
