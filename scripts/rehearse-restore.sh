#!/usr/bin/env bash
# Rehearse a WorldForge backup restore into a disposable Docker volume.
#
#   bash scripts/rehearse-restore.sh backups/worldforge-TIMESTAMP.tar.gz [IMAGE]
#
# The archive must contain exactly one top-level directory with worldforge.db,
# assets/ and optionally manifest.txt, as produced by docs/backup-restore.md.
# The live service and its volume are never touched: the script creates a
# synthetic volume, applies the documented restore command, and verifies
# integrity, migrations, ownership, permissions, database-referenced assets, and
# the archived asset count as UID/GID 10001.
set -euo pipefail

archive="${1:?Usage: bash scripts/rehearse-restore.sh BACKUP.tar.gz [IMAGE]}"
image="${2:-${WORLDFORGE_IMAGE:-worldforge:local}}"
[ -f "$archive" ] || { echo "Backup archive not found: $archive" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required for the restore rehearsal." >&2; exit 1; }
docker image inspect "$image" >/dev/null 2>&1 || { echo "Image not found locally: $image" >&2; exit 1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/worldforge-restore-XXXXXX")
volume="worldforge-restore-rehearsal-$(date +%s)-$$"
volume_created=0
cleanup() {
  status=$?
  rm -rf "$tmp"
  if [ "$volume_created" = 1 ]; then
    if ! docker volume rm -f "$volume" >/dev/null 2>&1; then
      echo "FAIL: could not remove disposable volume $volume; it may contain backup data." >&2
      status=1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

# Reject links, devices, absolute paths, traversal, and multiple recovery roots
# before anything is extracted.
python3 - "$archive" "$tmp" <<'PY'
import os, sys, tarfile

archive, dest = sys.argv[1], sys.argv[2]
problems = []
roots = set()
with tarfile.open(archive) as bundle:
    members = bundle.getmembers()
    for member in members:
        name = member.name
        parts = name.split("/")
        if name.startswith("/") or ".." in parts or "" in parts[:-1]:
            problems.append(f"unsafe path: {name}")
            continue
        if not (member.isfile() or member.isdir()):
            problems.append(f"unsupported entry type: {name}")
            continue
        roots.add(parts[0])
    if len(roots) != 1:
        problems.append(f"archive must contain exactly one top-level directory (found {len(roots)})")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        raise SystemExit(1)
    bundle.extractall(dest, filter="data")
PY

mapfile -t databases < <(find "$tmp" -type f -name worldforge.db -print)
[ "${#databases[@]}" -eq 1 ] || { echo "Backup must contain exactly one worldforge.db (found ${#databases[@]})" >&2; exit 1; }
restore_root=$(dirname "${databases[0]}")
[ -d "$restore_root/assets" ] || { echo "Backup has no assets directory beside the database" >&2; exit 1; }
expected_assets=$(find "$restore_root/assets" -type f | wc -l | tr -d ' ')

docker volume create "$volume" >/dev/null
volume_created=1
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
    test "$(id -g)" = 10001
    test "$(sqlite3 /data/worldforge.db "PRAGMA integrity_check;")" = ok
    test "$(stat -c %u:%g:%a /data/worldforge.db)" = "10001:10001:600"
    test -d /data/assets
    test "$(stat -c %u:%g:%a /data/assets)" = "10001:10001:700"
    test -z "$(find /data/assets -type f \( ! -user 10001 -o ! -group 10001 -o ! -perm 600 \) -print -quit)"
    test -z "$(find /data/assets -type d \( ! -user 10001 -o ! -group 10001 -o ! -perm 700 \) -print -quit)"
    actual=$(find /data/assets -type f | wc -l | tr -d " ")
    test "$actual" = "$EXPECTED_ASSETS"
    current_unfinished=$(sqlite3 /data/worldforge.db "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;" | while IFS= read -r name; do [ -d "/app/prisma/migrations/$name" ] && echo "$name"; done)
    test -z "$current_unfinished"
    legacy_unfinished=$(sqlite3 /data/worldforge.db "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;" | while IFS= read -r name; do [ -d "/app/prisma/migrations/$name" ] || echo "$name"; done | wc -l | tr -d " ")
    migrations=$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
    test "$migrations" -gt 0
    referenced=$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM ImageAsset;")
    missing=$(sqlite3 /data/worldforge.db "SELECT id FROM ImageAsset;" | while IFS= read -r id; do [ -f "/data/assets/$id.webp" ] || echo "$id"; done)
    test -z "$missing"
    tables=$(sqlite3 /data/worldforge.db "SELECT COUNT(*) FROM sqlite_master;")
    test "$tables" -gt 0
    printf "rehearsal-ok tables=%s migrations=%s legacy-unfinished=%s referenced-assets=%s archived-assets=%s\n" "$tables" "$migrations" "$legacy_unfinished" "$referenced" "$actual"
  ')

if ! docker volume rm -f "$volume" >/dev/null 2>&1; then
  echo "FAIL: could not remove disposable volume $volume; it may contain backup data." >&2
  exit 1
fi
volume_created=0

echo "Restore rehearsal passed for $archive using image $image."
echo "$result"
echo "Disposable volume $volume removed; the live service was not touched."
