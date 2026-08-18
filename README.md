# Project Journal MCP

A runnable first slice of the [implementation plan](./PLAN.md): a token-authenticated MCP server that stores project and pull-request notes in SQLite.

## Start it

Docker Compose is the shortest path:

```sh
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:3000/healthz
```

The local default MCP endpoint is `http://127.0.0.1:3000/mcp` and its development bearer token is `local-codex-token`. Copy `.env.example` to `.env` and replace the credentials before exposing the service beyond your machine.

For a production Swarm deployment behind Traefik, follow the [production deployment runbook](./deploy/README.md). It uses versioned Docker Hub images, local SQLite storage pinned to one node, and a Docker secret for MCP credentials.

Run the included end-to-end client against the container:

```sh
npm install
npm run test:mcp
```

This lists the tools, creates a uniquely named smoke-test project, records a PR note, then reads it back.

## MCP client configuration

Configure an HTTP-capable MCP client with:

- URL: `http://127.0.0.1:3000/mcp`
- Header: `Authorization: Bearer local-codex-token`

For two agents, set a comma-separated token map in `.env`:

```dotenv
MCP_TOKENS=codex:a-long-random-codex-token,claude:a-long-random-claude-token
```

The authenticated credential determines message attribution; callers do not supply their own actor value.

## Tools

| Tool | Purpose |
| --- | --- |
| `project_create` | Create a project and attach GitHub repositories |
| `project_list` | Discover projects and repository mappings |
| `pr_update_record` | Create/find a PR thread and append a note |
| `pr_message_amend` | Correct a note while retaining amendment history |
| `project_journal_get` | Read recent notes with repository/actor filters |

Writes through `pr_update_record` require an idempotency key. Retrying the same key as the same authenticated agent returns the original result without writing a duplicate note.

## Data and operations

SQLite is stored in the Compose volume `journal-data`. The server enables WAL mode, foreign keys, and a five-second busy timeout. Inspect or back up the volume with:

```sh
docker compose exec journal node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/data/journal.sqlite'); console.log(db.prepare('select slug,name from projects').all())"
docker compose cp journal:/data/journal.sqlite ./journal-backup.sqlite
```

The copy command is convenient for local testing, but a production backup must use SQLite's backup API or a checkpointed snapshot as specified in the plan.

## Local development

Requires Node.js 22 or newer (Node 24 is used in Docker):

```sh
npm install
npm test
npm run build
MCP_TOKENS=codex:local-codex-token npm start
```

Configuration:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `3000` | Listen port |
| `DATABASE_PATH` | `./data/journal.sqlite` | Live SQLite path |
| `MCP_TOKENS` | `codex:local-codex-token` | Comma-separated `agent:token` credentials |
| `MCP_TOKENS_FILE` | unset | File containing `agent:token` credentials; mutually exclusive with `MCP_TOKENS` |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | Host and browser-origin allowlist |

## Current scope

This working copy implements storage and the initial MCP contract. Timeline UI, deterministic Markdown export, scheduled validated backups, NFS retention, and Swarm deployment remain later phases from the plan.
