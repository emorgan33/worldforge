# Backup and Restore Guide

Updated: October 15, 2026.

WorldForge stores two types of data that must be backed up together:

1. **SQLite Database** (`data/*.db`) - All world metadata, articles, categories, users, sessions, etc.
2. **Asset Files** (`data/assets/`) - Uploaded images in WebP format

## Backing Up

### 1. Database Backup

```bash
# Create a timestamped backup of the SQLite database
cp data/worldforge.db "data/worldforge-$(date +%Y%m%d-%H%M%S).db"

# Or create a compressed backup
sqlite3 data/worldforge.db ".backup 'data/worldforge-backup.db'" && gzip data/worldforge-backup.db
```

The `.backup` command creates a consistent snapshot even if the database is being written to.

### 2. Asset Backup

```bash
# Create a timestamped archive of the assets directory
tar -czf "data/assets-$(date +%Y%m%d-%H%M%S).tar.gz" -C data assets
```

### 3. Complete Backup Script

```bash
#!/bin/bash
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Backup database
cp data/worldforge.db "$BACKUP_DIR/worldforge-$TIMESTAMP.db"

# Backup assets
tar -czf "$BACKUP_DIR/assets-$TIMESTAMP.tar.gz" -C data assets

# Create manifest
cat > "$BACKUP_DIR/manifest-$TIMESTAMP.txt" << EOF
WorldForge Backup - $TIMESTAMP
Database: worldforge-$TIMESTAMP.db
Assets: assets-$TIMESTAMP.tar.gz
Asset count: $(find data/assets -name "*.webp" | wc -l)
EOF

echo "Backup complete: $BACKUP_DIR/"
```

## Restoring from Backup

### 1. Stop the Server

```bash
# Stop the running WorldForge server
# The exact command depends on your deployment method
```

### 2. Restore Database

```bash
# Option A: Direct copy (simple but requires server stop)
cp backups/worldforge-TIMESTAMP.db data/worldforge.db

# Option B: Using sqlite3 (can be done while server is running with caution)
sqlite3 data/worldforge.db ".restore backups/worldforge-TIMESTAMP.db"
```

### 3. Restore Assets

```bash
# Remove current assets and restore from backup
rm -rf data/assets
tar -xzf backups/assets-TIMESTAMP.tar.gz -C data
```

### 4. Restart the Server

```bash
# Restart WorldForge
pnpm run start
# or your deployment-specific restart command
```

## World Export/Import (Per-World Backup)

For backing up individual worlds without stopping the server, use the built-in export/import feature:

### Exporting a World

1. Sign in to WorldForge
2. Navigate to your world
3. Go to World Settings
4. Click "Export World"

The export creates a JSON file containing all world data with embedded images.
It uses format 3, the complete owner backup (see below).

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
- **Concurrent Access**: During restore, ensure no users are accessing the system to prevent data inconsistency.
- **Large Worlds**: Worlds with many articles or large images may produce large export files. For a legacy-compatible world, `?format=v1&includeAssets=false` permits a partial export plus a separate asset copy. Formats 2 and 3 reject filtering flags; for complete portable backups, include the image bytes or use the SQLite-plus-assets workflow.

## Table-access system data

### World Export/Import v2

The world export format has been extended with versioned manifests to support the new table-access models. Version 2 exports include:

- Memberships and audience policies/grants
- Canon/provenance states (`canonState`, `revealedInSessionId`, `supersededById`)
- Campaign sessions and entity links
- Article quick facts, revision snapshots and remapped rich-text links
- Maps, layers, pins, groups and archived images
- Audit history as imported historical records

### World Export/Import v3

`GET /api/worlds/[id]/export` defaults to **format 3**, the complete owner
backup, and the Manage worlds export button uses it. Format 3 adds to format 2:

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
placement data the legacy shape would drop (including retained revision fields), with guidance to use format 3.

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

### Import behavior

- Imported worlds are always created as private with new IDs
- Resource relationships are remapped to new IDs. Mention graph edges are rebuilt from restored article content.
- Memberships and grants for accounts present on this installation are inactive. Unknown accounts are skipped with warnings.
- Revision snapshots are attributed to the importing account because source account IDs are not portable.
- Audit events are preserved as historical records; actors unavailable on this installation become anonymous.
- The export retains audit events with nullable resource references for deleted resources

### Backup considerations

The `AccessAuditEvent` table is append-only and grows over time. Consider planning for audit log rotation/archival for long-running campaigns.
