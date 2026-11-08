#!/usr/bin/env bash
set -euo pipefail

# Always use a unique project, disposable named volume and ephemeral loopback
# port. Ignore local .env files: this must never open an operator's database.
# Set WORLDFORGE_EXPECTED_ARCH=amd64|arm64 to require a specific image platform.
root=$(cd "$(dirname "$0")/.." && pwd)
image="${1:?Usage: bash scripts/smoke-release-image.sh IMAGE}"
export WORLDFORGE_IMAGE="$image"
export WORLDFORGE_ORIGIN=http://localhost:3033
export WORLDFORGE_TRUSTED_PROXY=0
export WORLDFORGE_HOST_BIND=127.0.0.1
export WORLDFORGE_HOST_PORT=0

image_arch=$(docker image inspect "$image" --format '{{.Architecture}}')
[[ -n "$image_arch" ]] || { echo "Could not determine the image architecture." >&2; exit 1; }
expected_arch="${WORLDFORGE_EXPECTED_ARCH:-$image_arch}"
case "$expected_arch" in
  amd64|arm64) ;;
  *) echo "Unsupported expected architecture: $expected_arch" >&2; exit 1 ;;
esac
[[ "$image_arch" == "$expected_arch" ]] || {
  echo "Image architecture $image_arch does not match expected $expected_arch." >&2
  exit 1
}

project="worldforge-image-test-$(date +%s)-$$"
case "$project" in
  worldforge-image-test-*) ;;
  *) echo "Refusing to use an unsafe Compose project name." >&2; exit 1 ;;
esac
compose=(docker compose --env-file /dev/null -p "$project" -f "$root/docker-compose.release.yml")
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then "${compose[@]}" logs worldforge || true; fi
  if ! "${compose[@]}" down --volumes; then
    echo "Failed to remove disposable Compose project $project." >&2
    [ "$status" -eq 0 ] && status=1
  fi
  exit "$status"
}
trap cleanup EXIT

"${compose[@]}" up -d --pull never --wait --wait-timeout 240
address=$("${compose[@]}" port worldforge 3033)
curl --fail --silent --show-error "http://$address/login" -o /dev/null

"${compose[@]}" exec -T worldforge sh -c '
  set -e
  test "$(id -u)" = 10001
  test "$(id -g)" = 10001
  test "$(sqlite3 /data/worldforge.db "PRAGMA integrity_check;")" = ok
  test -d /data/assets
  test "$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM _prisma_migrations;")" -gt 0
  test "$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;")" = 0
  pnpm exec prisma --version > /dev/null
  pnpm auth:setup -- --create image-smoke@example.invalid > /dev/null 2>&1
  pnpm admin:bootstrap -- image-smoke@example.invalid > /dev/null
  test "$(sqlite3 /data/worldforge.db "SELECT role FROM User WHERE email=\"image-smoke@example.invalid\";")" = ADMIN
  node scripts/assert-sqlite-version.cjs
'

prepare_output=$("${compose[@]}" exec -T worldforge pnpm exec tsx scripts/smoke-release-runtime.ts prepare "$expected_arch")
asset_sha256=$(printf '%s\n' "$prepare_output" | sed -n 's/^ASSET_SHA256=//p' | tail -n1)
[[ "$asset_sha256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Runtime prepare did not return a valid asset checksum." >&2
  exit 1
}

container_before=$("${compose[@]}" ps -q worldforge)
[[ -n "$container_before" ]] || { echo "No running container to recreate." >&2; exit 1; }
# Remove the container and network but retain the named volume, then recreate.
"${compose[@]}" down
"${compose[@]}" up -d --pull never --wait --wait-timeout 240
container_after=$("${compose[@]}" ps -q worldforge)
[[ -n "$container_after" && "$container_before" != "$container_after" ]] || {
  echo "Container was not recreated while retaining persistent storage." >&2
  exit 1
}
address=$("${compose[@]}" port worldforge 3033)
curl --fail --silent --show-error "http://$address/login" -o /dev/null

"${compose[@]}" exec -T worldforge pnpm exec tsx scripts/smoke-release-runtime.ts verify "$expected_arch" "$asset_sha256"
"${compose[@]}" exec -T worldforge sh -s <<'SMOKE'
set -e
test "$(sqlite3 /data/worldforge.db "PRAGMA integrity_check;")" = ok
test "$(sqlite3 /data/worldforge.db "SELECT role FROM User WHERE email='image-smoke@example.invalid';")" = ADMIN

# Build an older-schema fixture from every migration except the newest, add
# preserved data, then apply the pending migration with the current tooling.
upgrade=/data/smoke-upgrade
rm -rf "$upgrade"
mkdir -p "$upgrade/prisma/migrations"
cp /app/prisma/schema.prisma "$upgrade/prisma/schema.prisma"
all=$(ls -1 /app/prisma/migrations | grep -E '^[0-9]' | sort)
last=$(printf '%s\n' "$all" | tail -n1)
for migration in $all; do
  [ "$migration" = "$last" ] && continue
  cp -R "/app/prisma/migrations/$migration" "$upgrade/prisma/migrations/"
done
DATABASE_URL="file:$upgrade/old.db" pnpm exec prisma migrate deploy --schema "$upgrade/prisma/schema.prisma" > /dev/null
sqlite3 "$upgrade/old.db" "INSERT INTO User (id,name,email,createdAt,updatedAt) VALUES ('upgrade-marker','Upgrade Marker','upgrade-marker@example.invalid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);"
test "$(sqlite3 "$upgrade/old.db" "SELECT COUNT(*) FROM User WHERE id='upgrade-marker';")" = 1
DATABASE_URL="file:$upgrade/old.db" pnpm exec prisma migrate deploy > /dev/null
test "$(sqlite3 "$upgrade/old.db" "SELECT COUNT(*) FROM User WHERE id='upgrade-marker';")" = 1
test "$(sqlite3 "$upgrade/old.db" 'SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;')" = 0
test "$(sqlite3 "$upgrade/old.db" 'SELECT COUNT(*) FROM InstallationAdminState;')" = 1
test "$(sqlite3 "$upgrade/old.db" 'SELECT COUNT(*) FROM _prisma_migrations;')" = "$(ls -1 /app/prisma/migrations | grep -E '^[0-9]' | wc -l | tr -d ' ')"
rm -rf "$upgrade"
SMOKE

echo "Release image healthy; architecture, native libraries, migrations and persistent storage verified."
