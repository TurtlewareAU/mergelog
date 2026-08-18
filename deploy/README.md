# Production deployment runbook

This runbook publishes a versioned image to Docker Hub and deploys one Project Journal replica to Docker Swarm behind Traefik. SQLite remains on local storage belonging to a labelled Swarm node. MCP credentials are mounted as a Docker secret.

## Prerequisites

- A Docker Swarm manager
- A running Traefik service using an attachable overlay network
- DNS for the journal hostname pointing to Traefik
- A valid Traefik TLS certificate resolver
- A Docker Hub repository named `mergelog`
- A Docker Hub personal access token with read/write permission for CI
- Local storage on the selected Swarm node

Commands using `docker node`, `docker secret`, and `docker stack` must run on a Swarm manager.

## 1. Publish a release image

The `Build and publish Docker image` GitHub workflow runs for semantic version tags. It builds and tests the application before publishing Docker Hub tags for the release and commit SHA.

Configure these settings under **GitHub repository → Settings → Secrets and variables → Actions**:

- Variable `DOCKERHUB_NAMESPACE`: your Docker Hub username or organization namespace
- Secret `DOCKERHUB_TOKEN`: a Docker Hub personal access token with permission to push the `mergelog` repository

From a clean, current `main` branch:

```sh
git switch main
git pull --ff-only
npm ci
npm run build
npm test

git tag -a v0.1.0 -m "Project Journal v0.1.0"
git push origin v0.1.0
```

Wait for the GitHub workflow to complete, then use the immutable release tag or the published digest:

```text
docker.io/YOUR_DOCKERHUB_NAMESPACE/mergelog:0.1.0
```

Do not deploy `latest`; the publishing workflow intentionally does not create it.

## 2. Prepare the storage node

Choose the node that will own the live SQLite database:

```sh
docker node ls
docker node update --label-add mergelog.storage=true STORAGE_NODE_NAME
```

On that node, create the local data directory for the image's UID/GID 1000 process:

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /mnt/docker/mergelog
```

Do not place the live database on NFS. Backups may be copied off-node after using a SQLite-aware snapshot process.

## 3. Confirm the Traefik network

Find the overlay network shared by Traefik services:

```sh
docker network ls --filter driver=overlay
```

The default expected by the stack is `traefik-public`. If yours differs, set `TRAEFIK_NETWORK` in the deployment environment.

## 4. Create the MCP token secret

Generate a 32-byte token and save it in a password manager. On the Swarm manager, read that saved value without echoing it and create the versioned secret:

```sh
read -rsp "Codex MCP token: " CODEX_MCP_TOKEN
printf '\n'
printf 'codex:%s' "$CODEX_MCP_TOKEN" | docker secret create mergelog_mcp_tokens_v1 -
unset CODEX_MCP_TOKEN
```

For multiple agents, the secret content is a comma-separated list:

```text
codex:LONG_CODEX_TOKEN,claude:LONG_CLAUDE_TOKEN
```

Swarm secrets are immutable. Rotate credentials by creating a new versioned secret, updating `MERGELOG_TOKEN_SECRET`, deploying the stack, verifying it, and only then removing the old secret.

## 5. Configure the deployment

Copy the example without committing the resulting file:

```sh
cp deploy/.env.example deploy/.env
```

Set at least:

```dotenv
MERGELOG_IMAGE=docker.io/YOUR_DOCKERHUB_NAMESPACE/mergelog:0.1.0
MERGELOG_HOSTNAME=journal.example.com
MERGELOG_DATA_PATH=/mnt/docker/mergelog
MERGELOG_TOKEN_SECRET=mergelog_mcp_tokens_v1
TRAEFIK_NETWORK=traefik-public
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencrypt
```

Render and inspect the final stack before deployment:

```sh
set -a
. deploy/.env
set +a
docker stack config --compose-file deploy/stack.yaml
```

## 6. Authenticate to Docker Hub

If the repository is private or subject to authenticated pull limits, authenticate with a Docker Hub personal access token that can read it:

```sh
printf '%s' "$DOCKERHUB_TOKEN" | docker login --username DOCKERHUB_USERNAME --password-stdin
```

## 7. Deploy

With the deployment variables still exported:

```sh
docker stack deploy \
  --with-registry-auth \
  --resolve-image always \
  --compose-file deploy/stack.yaml \
  mergelog
```

The stack deliberately uses one replica, a storage-node placement constraint, and `stop-first` updates. Those settings prevent two application processes from writing to the same SQLite database.

## 8. Verify

Check scheduling, convergence, and logs:

```sh
docker stack services mergelog
docker service ps mergelog_journal
docker service logs --tail 100 mergelog_journal
```

Verify HTTPS and the unauthenticated health endpoint:

```sh
curl --fail --show-error "https://${MERGELOG_HOSTNAME}/healthz"
```

Verify that the MCP endpoint rejects missing credentials:

```sh
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST "https://${MERGELOG_HOSTNAME}/mcp"
```

Expected status: `401`.

Run the real MCP create/write/read smoke test from a trusted machine:

```sh
MCP_URL="https://${MERGELOG_HOSTNAME}/mcp" \
MCP_TOKEN="YOUR_CODEX_MCP_TOKEN" \
npm run test:mcp
```

The smoke test creates a persistent `smoke-*` project and PR note.

## 9. Connect Codex

Make the same Codex token available to the process that launches Codex:

```sh
export MERGELOG_MCP_TOKEN="YOUR_CODEX_MCP_TOKEN"
```

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.mergelog]
url = "https://journal.example.com/mcp"
bearer_token_env_var = "MERGELOG_MCP_TOKEN"
required = true
default_tools_approval_mode = "writes"
tool_timeout_sec = 30
```

Restart Codex and confirm the server is connected:

```sh
codex mcp list
```

## Upgrade

Publish a new version tag, update `MERGELOG_IMAGE` in `deploy/.env`, render the configuration, and repeat `docker stack deploy`. Swarm resolves the tag to a digest and performs the configured update.

## Rollback

For an immediate rollback of the most recent service update:

```sh
docker service rollback mergelog_journal
docker service ps mergelog_journal
```

For a durable rollback, set `MERGELOG_IMAGE` to the previous release tag or digest and redeploy the stack. This keeps the declared configuration consistent with the running service.

Application rollback does not roll back the SQLite schema. Review migration compatibility before deploying future releases that introduce destructive migrations.

## Remove an obsolete secret

After the replacement secret is active and verified:

```sh
docker secret rm OLD_SECRET_NAME
```

Never remove a secret while a running service still references it.
