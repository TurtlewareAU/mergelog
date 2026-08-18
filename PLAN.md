# Project Journal MCP — Implementation Plan

> Local reference exported from [PlanManager](https://plans.turtlez.au/p/tt810amx).
>
> PlanManager slug: `tt810amx` · Revision: 1 · Updated: 2026-08-18 09:13:35 UTC

**MVP:** v1

**Date:** August 2026

**Owner:** Homelab

**Status:** Approved for build

A self-hosted journal that lets Codex and Claude record concise, attributed notes against merged pull requests and presents each project as a readable conversation timeline.

## Executive overview

### Turn merged PRs into durable project memory

The service stores one canonical thread per pull request and accepts attributed messages from Codex, Claude, and humans. SQLite is authoritative; Markdown files and the visual timeline are projections. The MVP runs as one pinned Docker Swarm replica with its live database on local disk and validated backups on NFS.

| Measure | Target |
| --- | --- |
| Writer replicas | 1 |
| Initial MCP tools | 5 |
| Recovery point | Less than 1 hour |
| Source of truth | SQLite |

### MVP boundaries

Include GitHub project and PR threads, attributed messages, decisions, follow-ups, Markdown export, an unauthenticated read-only LAN timeline, authenticated MCP writes, backups, and audit history.

Exclude provider support beyond GitHub, automatic merge verification, Redis, multi-replica writes, and automatic cross-node failover.

## Architecture

### A small service with a deliberate durability boundary

Clients call the MCP endpoint over the homelab network. The application validates and deduplicates writes before committing to local SQLite. Exports and SQLite-aware backup snapshots are copied to NFS; the live database never resides there.

Primary application flow:

1. PR merged.
2. Agent reviews final diff.
3. MCP validates update.
4. SQLite transaction commits.
5. Timeline and export are produced.

### Components

#### Application — TypeScript service

- Streamable HTTP MCP transport
- REST/read endpoints for UI
- Schema validation and idempotency
- Structured logs and health checks

#### Live storage — local SQLite

- Mounted under local `/mnt/docker`
- WAL, foreign keys, and busy timeout
- One application replica
- Versioned migrations

#### Durability — NFS backup target

- Hourly validated snapshots
- Daily and monthly retention
- Generated Markdown exports
- Off-node restore source

> **Swarm constraint:** Label and pin both the application and backup job to the node containing the local database. A future requirement for transparent node relocation should trigger migration to PostgreSQL rather than placing live SQLite on NFS.

## Delivery roadmap

Build in four independently verifiable phases. Each phase produces a usable increment and finishes with tests or an operational exercise.

### Phase 1 — Foundation and storage

Scaffold the containerised service, configuration, migrations, and SQLite repositories. Model projects, repositories, PR threads, messages, decisions, follow-ups, API clients, and audit events. Add canonical repository normalization and uniqueness constraints.

### Phase 2 — MCP write and read tools

Implement token-authenticated MCP tools with strict schemas, idempotency keys, bounded field sizes, and stable error codes. Codex and Claude may create projects and manage their updates. Add tests for retries, duplicate PRs, corrections, unknown projects, and concurrent requests.

### Phase 3 — Timeline and exports

Build a responsive read-only project timeline with filters for project, repository, agent, and date. Generate deterministic Markdown per project from SQLite and expose JSON export for portability.

### Phase 4 — Swarm operations and recovery

Create the stack file, node placement rules, secrets, health checks, and scheduled backup job. Validate backup integrity, retention, and complete restoration onto a replacement node.

> **Release gate:** MVP is complete only after an identical write can be retried without duplication, two agents can add messages to one PR, the Markdown export matches the timeline, and a clean deployment can restore every record from NFS backup.

## MCP contract

### Small tools, predictable writes, readable output

Projects should be created deliberately; agents primarily work with existing projects and PR threads. Every mutating request records the authenticated client and accepts an idempotency key.

### `project_create`

- Create an explicit project slug and display name.
- Codex and Claude may create and manage projects.
- Attach one or more GitHub repositories.
- Reject conflicting slugs and normalized repositories.

### `pr_update_record`

- Create or locate a PR thread.
- Append agent summary, decisions, and follow-ups.
- Store PR URL, merge SHA/time, and reported status.
- Require an idempotency key.

### `pr_message_amend`

- Correct an existing message without erasing history.
- Record reason, actor, and before/after audit data.
- Disallow silent destructive edits.

### `project_journal_get`

- Return recent entries with pagination.
- Filter by repository, agent, and date.
- Support structured data or rendered Markdown.

### `project_list`

- Discover valid project slugs.
- Return attached repository mappings.
- Keep agents from inventing typo projects.

### Write protections

- Controlled agent values: `codex`, `claude`, and `human`.
- Maximum lengths and list counts.
- No secrets, raw diffs, or environment dumps.
- Soft deletion reserved for administration.

### Acceptance criteria

- Canonical identity is `provider:owner/repository:pr_number`.
- Repeated calls with the same client and idempotency key return the original result.
- Merge state is marked *reported* until a future provider integration verifies it.
- All timestamps are stored in UTC and rendered in the viewer's timezone.

## Data and operations matrix

SQLite owns durable application state. Everything on NFS is a completed backup or reproducible export, never a live database file.

| Concern | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Project identity | Project slug plus many repository mappings | Normalization and uniqueness tests | MVP |
| PR identity | Unique provider, normalized repository, and PR number | Duplicate and case-variation tests | MVP |
| Conversation | PR thread with attributed append-only messages | Codex and Claude message scenario | MVP |
| MCP authentication | Hashed bearer token per Codex or Claude client; write access includes project creation | Unauthorized and idempotent write tests | MVP |
| Timeline access | Read-only UI available without authentication on the trusted LAN | UI exposes no mutation endpoints or sensitive token data | MVP |
| Hourly and daily backup | SQLite backup API to a local temporary file, integrity check, then atomic copy to the off-node NFS mount | Failure POST sent to the configured n8n webhook | MVP |
| Retention | 48 hourly, 30 daily, and 12 monthly snapshots | Automated pruning tests | MVP |
| Restore | Documented replacement-node recovery procedure | Destructive clean-room restore drill | Release gate |
| GitHub verification | Provider adapter validates merge metadata | Integration test against provider | Later |
| High availability | Migrate storage layer to PostgreSQL | Multi-node failover exercise | Later |

## Confirmed decisions

Core product and deployment choices are confirmed. Exact host and NFS paths, secrets, and the n8n webhook URL remain environment configuration supplied at deployment time.

### One canonical PR thread

- Many attributed messages per PR
- SQLite is authoritative
- Markdown is deterministic export
- Timeline UI is read-only in MVP

### TypeScript and GitHub

- TypeScript service and MCP SDK
- GitHub is the only MVP provider
- Bearer token per MCP client
- Timeline requires no initial authentication

### Agent-managed journal

- Codex and Claude can create projects
- Both agents create and update PR notes
- Agent reviews the final diff before summarising
- Server records merge as reported

### Deployment decisions

The live SQLite database is pinned to local host storage under the host's Docker data area. Hourly and daily SQLite-aware backups are written to an off-node NFS mount. Backup failures are posted to a configurable n8n webhook. Deployment paths and the webhook URL remain environment variables so the image is portable.

> **Product principle:** “Record the decisions and delivered outcome—not a transcript of the work.”
