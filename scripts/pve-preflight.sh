#!/usr/bin/env bash
set -Eeuo pipefail

required_commands=(docker curl git node npm)
for command_name in "${required_commands[@]}"; do
  command -v "${command_name}" >/dev/null || {
    echo "Missing required command: ${command_name}" >&2
    exit 1
  }
done

docker info >/dev/null
docker buildx version >/dev/null

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if (( node_major < 24 )); then
  echo "Node.js 24 or newer is required; found $(node --version)." >&2
  exit 1
fi

available_kib="$(df --output=avail -k "${RUNNER_TEMP:-/tmp}" | tail -n 1 | tr -d ' ')"
if (( available_kib < 5 * 1024 * 1024 )); then
  echo "At least 5 GiB of free runner disk is required." >&2
  exit 1
fi

{
  echo "### PVE runner preflight"
  echo "- Runner: ${RUNNER_NAME:-unknown}"
  echo "- Node: $(node --version)"
  echo "- npm: $(npm --version)"
  echo "- Docker: $(docker version --format '{{.Server.Version}}')"
  echo "- Free disk: $((available_kib / 1024 / 1024)) GiB"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
