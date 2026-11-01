# Upgrading and Releases

WorldForge security fixes land on `main`, while numbered release tags provide
stable checkpoints. There are currently no long-term-support branches.

## Before every upgrade

1. Read all release notes between the installed and target versions.
2. Record the current tag or commit and container image.
3. Stop WorldForge and create a verified database-and-assets backup.
4. Confirm enough free disk space exists for the backup, new image, migration,
   and temporary files.
5. Note any release-specific backfill or configuration change.

Do not use an individual world export as the only pre-upgrade backup.

## Upgrade an installation tracking `main`

```bash
git fetch origin
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs worldforge
```

## Upgrade to a release tag

Replace `v0.4.0` with the intended release:

```bash
git fetch --tags
git checkout v0.4.0
docker compose up -d --build
docker compose ps
docker compose logs worldforge
```

The container validates configuration and runs `prisma migrate deploy` before
starting the application. A configuration failure occurs before migrations;
a migration failure leaves the service stopped and must be investigated rather
than bypassed.

Native installations run `pnpm install`, `pnpm db:generate`,
`pnpm db:deploy`, build, and restart using the release's documented Node and
pnpm versions. Docker remains the supported self-hosting path.

## Verify after upgrading

- Confirm the health check and startup logs are clean.
- Sign in and open `/admin` if installation administration is used.
- Open representative worlds, articles, readers, and uploaded images.
- Test one write and, when applicable, player access or public publication.
- Confirm backup jobs still target both the database and asset directory.
- Run release-specific backfills only when the notes explicitly require them.

## Rollback

Application code and database schema must be treated as a matched set. Do not
simply start an older image against a database that has received newer
migrations.

To roll back, stop the service and restore the pre-upgrade SQLite database and
matching assets together, then run the application version recorded with that
backup. Follow [Backup and Restore](Backup-and-Restore) and verify the recovered
installation before reopening access.

## Release-note discipline

Release notes should identify user-visible changes, migrations, configuration
changes, one-time backfills, known limitations, and exact upgrade commands.
Operator guidance in this wiki is updated from reviewed source under `wiki/`;
historical release evidence remains under `docs/releases/`.

**Source owner:** `wiki/Upgrading-and-Releases.md`; adapted from
`docs/releases/`, `docs/deployment-configuration.md`, and
`docs/backup-restore.md`.
**Verified against:** WorldForge commit `fdff259` (October 31, 2026).
