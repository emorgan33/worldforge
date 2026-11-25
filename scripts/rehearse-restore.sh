#!/usr/bin/env bash
# Rehearse a WorldForge backup restore into a disposable Docker volume.
#
#   bash scripts/rehearse-restore.sh backups/worldforge-TIMESTAMP.tar.gz [IMAGE]
#
# The archive must contain worldforge.db, assets/ and optionally manifest.txt
# under one top-level directory, as produced by docs/backup-restore.md. The live
# service and its volume are never touched: the script creates a synthetic
# volume, applies the documented restore command, and verifies integrity,
# ownership, permissions, and asset count as UID/GID 10001.
set -euo pipefail

archive="${1:?Usage: bash scripts/rehearse-restore.sh BACKUP.tar.gz [IMAGE]}"
image="${2:-${WORLDFORGE_IMAGE:-worldforge:local}}"
[ -f "$archive" ] || { echo "Backup archive not found: $archive" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required for the restore rehearsal." >&2; exit 1; }
docker image inspect "$image" >/dev/null 2>&1 || { echo "Image not found locally: $image" >&2; exit 1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/worldforge-restore-XXXXXX")
volume="worldforge-restore-rehearsal-$(date +%s)-$$"
cleanup() {
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

tar -xzf "$archive" -C "$tmp"
db=$(find "$tmp" -maxdepth 3 -name worldforge.db -type f | head -n1)
[ -n "$db" ] || { echo "Backup archive has no worldforge.db" >&2; exit 1; }
restore_root=$(dirname "$db")
[ -d "$restore_root/assets" ] || { echo "Backup archive has no assets directory beside the database" >&2; exit 1; }
expected_assets=$(find "$restore_root/assets" -type f | wc -l | tr -d ' ')

docker volume create "$volume" >/dev/null
docker run --rm --user 0:0 \
  -v "$volume:/data" \
  -v "$restore_root:/restore:ro" \
  --entrypoint sh "$image" -c '
    set -e
    test "$(sqlite3 /restore/worldforge.db "PRAGMA integrity_check;")" = ok
    cp /restore/worldforge.db /data/worldforge.db.restore
    rm -f /data/worldforge.db-journal /data/worldforge.db-wal /data/worldforge.db-shm
    mv /data/worldforge.db.restore /data/worldforge.db
    rm -rf /data/assets && mkdir -p /data/assets
    cp -a /restore/assets/. /data/assets/
    chown -R 10001:10001 /data/worldforge.db /data/assets
    find /data/assets -type d -exec chmod 700 {} +
    find /data/assets -type f -exec chmod 600 {} +
    chmod 600 /data/worldforge.db
  '

result=$(docker run --rm -v "$volume:/data" --user 10001:10001 \
  -e EXPECTED_ASSETS="$expected_assets" \
  --entrypoint sh "$image" -c '
    set -e
    test "$(id -u)" = 10001
    test "$(sqlite3 /data/worldforge.db "PRAGMA integrity_check;")" = ok
    test -d /data/assets
    test "$(stat -c %u /data/worldforge.db)" = 10001
    test "$(stat -c %a /data/worldforge.db)" = 600
    test "$(stat -c %u /data/assets)" = 10001
    test "$(stat -c %a /data/assets)" = 700
    actual=$(find /data/assets -type f | wc -l | tr -d " ")
    test "$actual" = "$EXPECTED_ASSETS"
    test -z "$(find /data/assets -type f ! -perm 600 -print -quit)"
    tables=$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM sqlite_master;")
    migrations=$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;")
    test "$tables" -gt 0
    test "$migrations" -gt 0
    printf "rehearsal-ok tables=%s migrations=%s assets=%s\n" "$tables" "$migrations" "$actual"
  ')

echo "Restore rehearsal passed for $archive using image $image."
echo "$result"
echo "Disposable volume $volume removed; the live service was not touched."
