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
5. Choose options:
   - **Include Assets**: Download image files (increases file size)
   - **Include Private Content**: Export unpublished articles and GM secrets

The export creates a JSON file containing all world data with embedded images.

### Importing a World

1. Sign in to WorldForge
2. Go to your worlds list
3. Click "Import World"
4. Upload the exported JSON file
5. Review import warnings (if any)
6. Confirm import

**Note:** Imported worlds are always set to private by default. Articles are imported as drafts.

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
- **Large Worlds**: Worlds with many articles or large images may produce large export files. Consider exporting without assets and manually copying the assets directory instead.

## Table-access system data

### World Export/Import v2

The world export format has been extended with versioned manifests to support the new table-access models. Version 2 exports include:

- Memberships and audience policies/grants
- Canon/provenance states (`canonState`, `revealedInSessionId`, `supersededById`)
- Campaign sessions and entity links
- Article quick facts, revision snapshots and remapped rich-text links
- Maps, layers, pins, groups and archived images
- Audit history as imported historical records

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
