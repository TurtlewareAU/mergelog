# Initial MCP server and SQLite storage

This PR establishes the first runnable Project Journal service from the implementation plan.

## Delivered

- MCP SDK 2.0 Streamable HTTP server with bearer-token authentication
- SQLite schema for projects, repositories, PR threads, attributed messages, amendments, idempotency keys, and audit events
- `project_create`, `project_list`, `pr_update_record`, `pr_message_amend`, and `project_journal_get` tools
- Docker Compose deployment with a persistent volume and health check
- Unit tests and an MCP SDK smoke client covering a create, write, and read round trip

## Validation

- `npm run build`
- `npm test`
- `docker compose config`
- Production image build and healthy container startup
- Authenticated MCP tool discovery and SQLite write/read round trip
- Unauthenticated MCP request rejected with HTTP 401

## Follow-up production work

Before wider deployment, configure strong per-agent tokens, trusted hostnames and HTTPS/network controls. SQLite-aware off-node backups, restore testing, Swarm placement constraints, the read-only timeline, and deterministic Markdown exports remain subsequent implementation phases.
