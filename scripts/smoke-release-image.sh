#!/usr/bin/env bash
set -euo pipefail

# Always use a unique project, disposable named volume and ephemeral loopback
# port. Ignore local .env files: this must never open an operator's database.
root=$(cd "$(dirname "$0")/.." && pwd)
export WORLDFORGE_IMAGE="${1:?Usage: bash scripts/smoke-release-image.sh IMAGE}"
export WORLDFORGE_ORIGIN=http://localhost:3033
export WORLDFORGE_TRUSTED_PROXY=0
export WORLDFORGE_HOST_BIND=127.0.0.1
export WORLDFORGE_HOST_PORT=0
project="worldforge-image-test-$(date +%s)-$$"
compose=(docker compose --env-file /dev/null -p "$project" -f "$root/docker-compose.release.yml")
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then "${compose[@]}" logs worldforge; fi
  "${compose[@]}" down --volumes
  exit "$status"
}
trap cleanup EXIT
"${compose[@]}" up -d --pull never --wait --wait-timeout 180
address=$("${compose[@]}" port worldforge 3033)
curl --fail --silent --show-error "http://$address/login" -o /dev/null
"${compose[@]}" exec -T worldforge sh -c \
  'test "$(sqlite3 /data/worldforge.db "PRAGMA integrity_check;")" = ok && test -d /data/assets'
echo "Release image healthy; login and fresh database verified."
