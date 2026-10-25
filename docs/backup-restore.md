# Backup and Restore Guide

Updated: October 25, 2026.

WorldForge stores two types of data that must be backed up together:

1. **SQLite Database** (`data/*.db`) - All world metadata, articles, categories, users, sessions, etc.
2. **Asset Files** (`data/assets/`) - Uploaded images in WebP format

## Backing up a self-hosted Compose installation

The database and asset directory form one recovery point. Stop the application
before copying either one; never copy a live SQLite database with `cp`, and do
not restore one component without the matching other component. The Compose
named volume survives container replacement.

From the directory containing `docker-compose.yml`:

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

SQLite's `.backup` command opens the stopped database through SQLite, allowing
hot-journal recovery and producing a consistent snapshot instead of copying a
possibly incomplete main file. The command checks the snapshot's integrity
before the assets are added. Keep the database, assets, and manifest together
in the archive. Store copies outside the host that runs WorldForge. If the
backup command fails, leave the service stopped until the copy is complete or
remove the partial directory and start it again. For local non-Compose installs,
stop the server service first, resolve `DATABASE_URL` to `DATABASE_FILE`, and
archive the SQLite snapshot and the complete `WORLDFORGE_ASSET_DIR` together:

```bash
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$PWD/backups/$stamp"
mkdir -p "$backup_dir"
sqlite3 "$DATABASE_FILE" ".backup '$backup_dir/worldforge.db'"
test "$(sqlite3 "$backup_dir/worldforge.db" 'PRAGMA integrity_check;')" = ok
tar -czf "$backup_dir/assets.tar.gz" -C "$WORLDFORGE_ASSET_DIR" .
printf 'Stopped local backup %s\n' "$stamp" > "$backup_dir/manifest.txt"
tar -czf "$PWD/backups/worldforge-$stamp.tar.gz" -C "$PWD/backups" "$stamp"
```

## Restoring a Compose backup

Stop the service and extract the selected archive. Preserve a separate copy of
the current volume before replacing it. The helper container mounts the same
named volume while the app is stopped, replaces both matching components, and
clears stale assets:

```bash
set -euo pipefail
docker compose stop worldforge
mkdir -p restore-work
tar -xzf backups/worldforge-TIMESTAMP.tar.gz -C restore-work
container=$(docker compose ps -aq worldforge | head -n 1)
docker run --rm --volumes-from "$container" \
  -v "$PWD/restore-work/TIMESTAMP:/restore:ro" \
  --entrypoint sh worldforge:local -c \
  'sqlite3 /restore/worldforge.db "PRAGMA integrity_check;" | grep -qx ok && cp /restore/worldforge.db /data/worldforge.db.restore && rm -f /data/worldforge.db-journal /data/worldforge.db-wal /data/worldforge.db-shm && mv /data/worldforge.db.restore /data/worldforge.db && rm -rf /data/assets && mkdir -p /data/assets && cp -a /restore/assets/. /data/assets/'
docker compose start worldforge
```

If the image tag differs from `worldforge:local`, substitute the image used by
the Compose service. The integrity check runs on the staged backup before it
replaces the database. The command removes stale rollback journals and WAL/SHM
files before atomically replacing the main database file, so a leftover journal
cannot replay over the restored copy. Startup applies pending Prisma migrations;
check the logs and verify the restored worlds and images before reopening access.

For a local install, resolve `DATABASE_FILE` and `WORLDFORGE_ASSET_DIR`, then
stop the process. This stages the checked database beside the live file so the
final rename is atomic, removes stale recovery sidecars, and replaces the asset
directory from the same recovery set:

```bash
set -euo pipefail
restored_db="${DATABASE_FILE}.restore"
test "$(sqlite3 backup/worldforge.db 'PRAGMA integrity_check;')" = ok
cp backup/worldforge.db "$restored_db"
test "$(sqlite3 "$restored_db" 'PRAGMA integrity_check;')" = ok
rm -f "${DATABASE_FILE}-journal" "${DATABASE_FILE}-wal" "${DATABASE_FILE}-shm"
mv "$restored_db" "$DATABASE_FILE"
mkdir -p "$WORLDFORGE_ASSET_DIR"
find "$WORLDFORGE_ASSET_DIR" -mindepth 1 -delete
tar -xzf backup/assets.tar.gz -C "$WORLDFORGE_ASSET_DIR"
```

Restart the app only after both components have been restored. Do not use
SQLite `.restore` against a live application or combine assets from one point
in time with a database from another.

## World Export/Import (Per-World Backup)

For backing up individual worlds without stopping the server, use the built-in export/import feature:

World imports accept an optional `Idempotency-Key` UUID. The author interface creates
and retains this key before sending the bundle. If the response is lost, it
queries the saved outcome or resends the same bundle and key; the server returns
the original result instead of creating another world. A key is bound to a
SHA-256 digest of the parsed bundle, so using it with different content returns
`409 Conflict`. Import request records are stored in SQLite and are removed
when their owner account is deleted.

If the server stops during an import, retry the same key and bundle after its
15-minute recovery lease expires. The server refreshes the lease while an import
is active, reuses deterministic IDs for that request, removes its partial world
and staged asset files, then runs the import again. Keep the request key with
the selected backup until the import completes. Import requests and their saved
outcomes are part of the SQLite backup. Requests without a key remain available
for legacy clients, but cannot be replayed safely after losing the response.

Definitive validation failures release the author interface's pending key so a
corrected backup can start with a new request. If rollback or completion is
uncertain, the request remains available for recovery with the same key and
bundle.

### Exporting a World

1. Sign in to WorldForge
2. Navigate to your world
3. Go to World Settings
4. Click "Export World"

The export creates a JSON file containing all world data with embedded images.
It uses format 4, the complete owner backup (see below).

### Importing a World

1. Sign in to WorldForge
2. Go to your worlds list
3. Click "Import World"
4. Upload the exported JSON file
5. Review import warnings (if any)
6. Confirm import

**Note:** Imported worlds are always private, and imported articles are drafts with
owner-only visibility. An imported article can be made public later by changing
its visibility and publication status in the editor. Older records with the
legacy `INHERITED` visibility value are treated as private when saved; no data
migration is required.

## Verification

After any restore, verify:

1. **Database integrity**:
   ```bash
   sqlite3 data/worldforge.db "PRAGMA integrity_check;"
   ```

2. **Asset accessibility**: Check that images load in the browser

3. **World count**: Compare world/article counts with expected values

## Disaster Recovery Checklist

- [ ] Database backup is recent (within 24 hours)
- [ ] Asset backup is recent and complete
- [ ] Backup files are stored on a different volume/server
- [ ] Restore procedure has been tested
- [ ] Server restart procedure is documented

## Moving to a New Server

1. Back up database and assets from the old server
2. Install WorldForge on the new server
3. Restore database and assets to the new server
4. Update `DATABASE_URL` in `.env` if the path changed
5. Update `WORLDFORGE_ASSET_DIR` in `.env` if the path changed
6. Restart the server

## Known Limitations

- **Asset cleanup**: Purging an archived world queues its image files for removal. If the filesystem is temporarily unavailable, the durable cleanup jobs are retried on a later trash visit.
- **Restore downtime**: Stop the application before replacing either the database or asset directory, and restart only after both matching components are restored.
- **Large Worlds**: Portable JSON exports and imports are limited to 60 MiB. Oversized exports fail explicitly; use the SQLite-plus-assets workflow. For a legacy-compatible world, `?format=v1&includeAssets=false` permits a partial export plus a separate asset copy. Formats 2, 3 and 4 reject filtering flags. Formats 1–3 predate era and stable annotation-order preservation; use format 4 when those details matter.

## Table-access system data

### World Export/Import v2

The world export format has been extended with versioned manifests to support the new table-access models. Version 2 exports include:

- Memberships and audience policies/grants
- Canon/provenance states (`canonState`, `revealedInSessionId`, `supersededById`)
- Campaign sessions and entity links
- Article quick facts, revision snapshots and remapped rich-text links
- Maps, layers, pins, groups and archived images
- Audit history as imported historical records

### World Export/Import v4

`GET /api/worlds/[id]/export` defaults to **format 4**, the complete owner
backup, and the Manage worlds export button uses it. Format 4 adds timeline eras
and event-to-era references, plus explicit map annotation ordering. Drawing
order is captured from the map's explicit element sequence (creation time and
ID provide deterministic ordering for legacy rows) and restored as that
sequence, preserving ink/erase/ink compositing.

Format 4 rejects `includeAssets` and `includePrivate` filters. Export and import
share a 60 MiB JSON byte limit. Oversized exports return an explicit error
directing operators to the SQLite-plus-assets backup workflow; imports enforce
the same limit while reading the request body. Per-asset and per-section limits
also remain in force.

### World Export/Import v3

Format 3 remains importable as a complete owner backup. It adds to format 2:

- Image provenance snapshots and acquisition source (`UPLOADED` / `STOCK` /
  `IMPORTED`), preserving exact credits across a restore.
- Operator restriction state (`displayRestricted`, `restrictionReason`,
  `restrictionDate`), so a restricted copy stays restricted after import.
- Per-placement descriptions: `World.coverImageAlt` / `bannerImageAlt`,
  `Article.coverImageAlt` / `portraitImageAlt`, and their revision snapshots.
- Category illustrations (`Category.iconImage`).

Because format 3 is defined as a complete backup, it rejects the `includeAssets`
and `includePrivate` query flags with `400` rather than silently returning a
partial file. The legacy formats remain available for worlds that can be captured
losslessly: `?format=v1` supports filtering; `?format=v2` is a complete backup
and rejects `includeAssets`/`includePrivate` flags explicitly. The
server refuses a legacy export of a world that has provenance, restrictions or
placement data the legacy shape would drop (including retained revision fields), with guidance to use format 4.

On import, provenance is validated before any write and any catalog id is marked
`IMPORTED_DECLARATION` — an imported entry is never treated as a rights review.
Malformed provenance fails that asset with a warning instead of importing its
artwork as an ordinary uncredited upload. Images are normalized again; if the
bytes change, the provenance chain is retained, both the source and stored
digests are recorded, and a re-encode warning is added. Placements that referenced
an unavailable image are cleared with a warning.

### Transfer adapter boundary

The import endpoint applies one bounded JSON transport reader and shared
section limits, then decodes the manifest version into a version-specific
`DecodedWorldTransfer`. A `CanonicalWorldTransfer` projection exposes common
source-world and core content fields for version-neutral operations. The
transfer execution module dispatches to the v1 or v2/v3 importer; the v1
import/export implementations are separate from the HTTP routes. Versions 1,
2, and 3 retain their existing import behavior; version 3 keeps its provenance
and placement checks. This internal representation does not change the
serialized formats, the 60 MB request limit, or the rule that imports are
private.

Legacy v1 import requires a nonempty world title and slug. Versions 2 and 3
retain their prior behavior and accept empty title or slug strings where the
database permits them.

### Withdrawing or restricting stock art

Operator advisories are applied with `pnpm stock-art:advisories` (see
[`stock-art.md`](stock-art.md)). An advisory matches installed copies by
provenance identity, sets `displayRestricted` (or clears it), and keeps the bytes
and provenance for owner review. Restricted art stops being served to readers and
is excluded from public and campaign pages; a re-export still carries the
restriction state.

### Excluded from export

- Password hashes
- Auth sessions and preview tokens
- Plaintext secret credentials
- Campaign notebooks and notebook entries. These remain local private prep data
  and are not part of portable world bundles; use the database-plus-assets
  backup to preserve them.

### Import behavior

- Imported worlds are always created as private with new IDs
- Resource relationships are remapped to new IDs. Mention graph edges are rebuilt from restored article content.
- Memberships and grants for accounts present on this installation are inactive. Unknown accounts are skipped with warnings.
- Revision snapshots are attributed to the importing account because source account IDs are not portable.
- Audit events are preserved as historical records; actors unavailable on this installation become anonymous.
- The export retains audit events with nullable resource references for deleted resources

### Backup considerations

The `AccessAuditEvent` table is append-only and grows over time. Consider planning for audit log rotation/archival for long-running campaigns.
