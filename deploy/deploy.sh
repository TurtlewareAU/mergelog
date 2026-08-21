#!/usr/bin/env bash
set -Eeuo pipefail

readonly stack_name="mergelog"
readonly service_name="${stack_name}_journal"
readonly timeout_seconds="${DEPLOY_TIMEOUT_SECONDS:-180}"

required_variables=(
  MERGELOG_IMAGE
  MERGELOG_HOSTNAME
  MERGELOG_DATA_PATH
  MERGELOG_TOKEN_SECRET
  TRAEFIK_NETWORK
  TRAEFIK_ENTRYPOINT
  TRAEFIK_CERT_RESOLVER
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required deployment variable: ${variable_name}" >&2
    exit 1
  fi
done

if [[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" != "true" ]]; then
  echo "This runner must execute on a Docker Swarm manager." >&2
  exit 1
fi

docker secret inspect "${MERGELOG_TOKEN_SECRET}" >/dev/null
docker network inspect "${TRAEFIK_NETWORK}" >/dev/null
if ! docker node ls \
  --filter "node.label=mergelog.storage=true" \
  --format '{{.ID}}' | grep --quiet .; then
  echo "No Swarm node has the required mergelog.storage=true label." >&2
  exit 1
fi

docker stack config --compose-file deploy/stack.yaml >/dev/null
docker stack deploy \
  --with-registry-auth \
  --resolve-image always \
  --compose-file deploy/stack.yaml \
  "${stack_name}"

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
  replicas="$(docker service ls --filter "name=${service_name}" --format '{{.Replicas}}')"
  update_state="$(docker service inspect --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' "${service_name}")"

  if [[ "${replicas}" == "1/1" && ( -z "${update_state}" || "${update_state}" == "completed" ) ]]; then
    if curl --fail --show-error --silent \
      --connect-timeout 5 \
      --max-time 10 \
      "https://${MERGELOG_HOSTNAME}/healthz" >/dev/null; then
      echo "Deployment completed: ${MERGELOG_IMAGE}"
      exit 0
    fi
  fi

  if [[ "${update_state}" == "paused" || \
    "${update_state}" == "rollback_paused" || \
    "${update_state}" == "rollback_completed" ]]; then
    echo "Deployment entered failure state: ${update_state}" >&2
    docker service ps --no-trunc "${service_name}" >&2
    exit 1
  fi

  sleep 5
done

echo "Deployment did not converge within ${timeout_seconds} seconds." >&2
docker service ps --no-trunc "${service_name}" >&2
exit 1
