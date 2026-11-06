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
# The volume is disposable. Verify operational tooling remains available after
# runtime hardening, without exposing the one-time account setup token.
"${compose[@]}" exec -T worldforge sh -c '
  set -e
  pnpm exec prisma --version > /dev/null
  pnpm auth:setup -- --create image-smoke@example.invalid > /dev/null 2>&1
  pnpm admin:bootstrap -- image-smoke@example.invalid > /dev/null
  test "$(sqlite3 /data/worldforge.db "SELECT role FROM User WHERE email=\"image-smoke@example.invalid\";")" = ADMIN
  node scripts/assert-sqlite-version.cjs
'
echo "Release image healthy; login, fresh database and setup/admin tooling verified."
