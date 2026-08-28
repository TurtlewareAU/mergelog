# Project Journal MCP

A token-authenticated MCP server that stores project and pull-request notes, with a public read-only journal UI. It supports local SQLite/Docker operation and a serverless Postgres deployment on Vercel.

For the hosted setup at `mergelog.turtlez.au`, including isolated Codex, Claude, and OpenCode credentials, follow the [Vercel deployment runbook](./docs/vercel-deployment.md).

## Start it

Docker Compose is the shortest path:

```sh
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:3000/healthz
```

Open the read-only Strata journal at `http://127.0.0.1:3000/`. The local default MCP endpoint is `http://127.0.0.1:3000/mcp` and its development bearer token is `local-codex-token`. Copy `.env.example` to `.env`, replace the credentials, and add the LAN hostname or IP you will use to `ALLOWED_HOSTS` before exposing the service beyond your machine.

Production is deployed through Vercel. Docker Compose remains available for local development and testing only.

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

For multiple agents, set a comma-separated token map in `.env`:

```dotenv
MCP_TOKENS=codex:a-long-random-codex-token,claude:a-long-random-claude-token,opencode:a-long-random-opencode-token
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

Requires Node.js `^20.19.0` or `>=22.12.0` (Node 24 is used in Docker):

```sh
npm install
npm test
npm run build
npm --prefix web install
npm --prefix web run build
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
| `WEB_DIST_PATH` | `./web/dist` | Compiled Strata frontend served by the application |

## Current scope

This working copy implements storage, the initial MCP contract, the read-only timeline UI, and a serverless Vercel deployment path. Deterministic Markdown export remains a later phase from the plan.
