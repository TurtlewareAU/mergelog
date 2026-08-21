#!/usr/bin/env bash
set -Eeuo pipefail

: "${IMAGE:?Set IMAGE to the locally built container image}"

readonly container_name="mergelog-check-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

cleanup() {
  docker rm --force "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach \
  --name "${container_name}" \
  --publish 127.0.0.1::3000 \
  --env MCP_TOKENS=codex:container-check-token \
  --env ALLOWED_HOSTS=localhost,127.0.0.1 \
  "${IMAGE}" >/dev/null

host_port="$(docker port "${container_name}" 3000/tcp | awk -F: 'NR == 1 {print $NF}')"
test -n "${host_port}"
readonly base_url="http://127.0.0.1:${host_port}"

for attempt in {1..30}; do
  if curl --fail --silent "${base_url}/healthz" >/dev/null 2>&1; then
    break
  fi

  if (( attempt == 30 )); then
    docker logs "${container_name}" >&2
    echo "Container did not become healthy." >&2
    exit 1
  fi
  sleep 1
done

status_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST "${base_url}/mcp")"
if [[ "${status_code}" != "401" ]]; then
  echo "Expected unauthenticated MCP request to return 401; received ${status_code}." >&2
  exit 1
fi

echo "Container health and authentication checks passed."
