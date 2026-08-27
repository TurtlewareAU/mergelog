# Vercel deployment

The Vercel deployment serves the read-only journal UI at `https://merge.turtlez.au`, public read-only JSON under `/api`, and the authenticated Streamable HTTP MCP endpoint at `/mcp`.

## 1. Create persistent storage

Create a serverless Postgres database (Vercel Marketplace Postgres, Neon, or another PostgreSQL provider) in the same region as the Vercel function. Add its pooled connection string to the Vercel project as `POSTGRES_URL`. `DATABASE_URL` is also accepted.

The application creates its schema on the first request. The database user therefore needs schema creation rights for the first deployment and normal read/write rights afterward.

## 2. Generate client credentials

Generate three independent high-entropy values locally. Do not commit their output:

```sh
printf 'codex:'; openssl rand -hex 32
printf 'claude:'; openssl rand -hex 32
printf 'opencode:'; openssl rand -hex 32
```

Join the resulting `agent:token` values with commas and add them as the encrypted Vercel environment variable `MCP_TOKENS`. Tokens must be at least 32 characters on Vercel. Also set:

```dotenv
ALLOWED_ORIGINS=https://merge.turtlez.au
```

Rotate one client without affecting the others by replacing its value and redeploying. Historical entries retain their actor attribution.

## 3. Deploy and attach the domain

Import this repository into Vercel and deploy the `feat/vercel-hosted-mcp` branch. The committed `vercel.json` builds the Vite UI and deploys the API function.

In Vercel, open **Project → Settings → Domains**, add `merge.turtlez.au`, and apply the DNS record Vercel provides at the authoritative DNS provider for `turtlez.au`. Keep the production branch setting on this branch until it is merged, then change it to `main`.

Verify the public and protected surfaces:

```sh
curl -i https://merge.turtlez.au/healthz
curl -i https://merge.turtlez.au/api/projects
curl -i https://merge.turtlez.au/mcp
```

The first two should return `200`; the unauthenticated MCP request should return `401`.

## 4. Configure MCP clients

Use `https://merge.turtlez.au/mcp` as a remote/Streamable HTTP MCP server and send the token assigned to that client:

```json
{
  "url": "https://merge.turtlez.au/mcp",
  "headers": {
    "Authorization": "Bearer <client-specific-token>"
  }
}
```

Use the Codex token only in Codex, the Claude token only in Claude, and the OpenCode token only in OpenCode. Exact config-file keys vary by client version, but the URL and header are identical.

## Access boundary

- Public, read-only: `/`, static assets, `GET /api/projects`, and `GET /api/projects/:slug/journal`.
- Authenticated MCP: `/mcp`; credentials determine `codex`, `claude`, or `opencode` attribution.
- No browser-facing write route exists. Writes are exposed only as MCP tools.
- Secrets remain in Vercel encrypted environment variables and are never returned by an endpoint.
