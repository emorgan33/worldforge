# Backup and Restore

WorldForge has two inseparable data stores:

- the SQLite database at `/data/worldforge.db` in the Compose volume
- uploaded and selected images under `/data/assets`

Back up and restore both from the same point in time. A world export is useful
for portability, but it is not a replacement for an installation backup.

## Back up a Compose installation

Run these commands from the directory containing `docker-compose.yml`. The
service is deliberately stopped so SQLite and the asset directory form one
consistent recovery point.

```bash
set -euo pipefail
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
container=$(docker compose ps -q worldforge)
test -n "$container"
docker compose stop worldforge
mkdir -p "backups/$stamp/assets"
docker run --rm --volumes-from "$container" \
  -v "$PWD/backups/$stamp:/backup" \
  --entrypoint sh worldforge:local -c \
  'sqlite3 /data/worldforge.db ".backup /backup/worldforge.db" && test "$(sqlite3 /backup/worldforge.db "PRAGMA integrity_check;")" = ok'
docker cp "$container:/data/assets/." "backups/$stamp/assets/"
printf 'WorldForge stopped backup %s\n' "$stamp" > "backups/$stamp/manifest.txt"
tar -czf "backups/worldforge-$stamp.tar.gz" -C backups "$stamp"
docker compose start worldforge
```

If any backup command fails, keep WorldForge stopped until you either complete
the backup or deliberately remove the partial output and restart the service.
Store a copy on a different machine or storage provider.

## Verify a backup

Before relying on an archive:

1. Extract it in a temporary directory.
2. Run `sqlite3 worldforge.db "PRAGMA integrity_check;"` and require `ok`.
3. Confirm the manifest and assets directory are present.
4. Periodically rehearse a restore on an isolated installation.

An archive existing is not proof that it can be restored.

## Restore a Compose installation

Restoration replaces data and is destructive. Preserve a separate copy of the
current volume first. Stop the service, extract the selected archive, and use
the complete checked procedure in the repository's
[backup guide](https://github.com/emorgan33/worldforge/blob/main/docs/backup-restore.md#restoring-a-compose-backup).

The procedure checks the staged database, removes stale SQLite journal/WAL/SHM
files, replaces the database and complete assets directory together, and then
starts WorldForge. Startup applies migrations required by the installed
application version.

After restoration:

- check `docker compose logs worldforge` for migration or startup failures
- run an SQLite integrity check
- sign in and compare expected worlds and article counts
- open representative uploaded images
- verify the restored application version matches the recovery plan

Never restore over a running server, combine a database with assets from a
different backup, or use SQLite `.restore` against the live application.

## Export or import one world

Owners can use **Manage worlds → Export World** for a portable JSON bundle and
**Import World** to restore it as a new private world. Current complete exports
use format 4 and include embedded images, private content, provenance,
timelines, and map annotation order.

- Bundles are limited to 60 MiB.
- Imports become private and their articles become owner-only drafts.
- Keep an import's idempotency key with the bundle until completion so a lost
  response can be retried safely.
- Oversized worlds require the SQLite-plus-assets installation backup.

## Recovery policy

Use a schedule appropriate to how much campaign work you can afford to lose.
Keep multiple generations, retain at least one off-host copy, and test restores.
Back up immediately before upgrades, account deletion, ownership changes, or
storage maintenance.

**Source owner:** `wiki/Backup-and-Restore.md`; adapted from
`docs/backup-restore.md`.
**Verified against:** WorldForge commit `fdff259` (October 31, 2026).
