# Upgrading and Releases

WorldForge security fixes land on `main`, while numbered release tags provide
stable checkpoints. There are currently no long-term-support branches.

## Choose an image or source release

The Docker Hub repository is
[`emorgan33/worldforge`](https://hub.docker.com/r/emorgan33/worldforge). New
multi-platform releases include **linux/amd64** and **linux/arm64** under the
same version/SHA tags; releases published before that support are AMD64-only.
Check the [GitHub release notes](https://github.com/emorgan33/worldforge/releases)
for the platforms, image tag, and digest after the **Release Docker image**
workflow succeeds. Older releases may have source tags only; do not assume an
image exists.

- Git tag `vX.Y.Z` maps to image `emorgan33/worldforge:X.Y.Z`.
- `sha-<full-commit>` identifies the source commit.
- `latest` follows GitHub's current stable release with a stable version tag;
  prereleases do not advance it. Prefer a version or digest pin for upgrades.
- A GitHub release publication triggers packaging; a `main` push or tag push
  alone does not. A failed publishing run is not a delivered image.

Image publication also scans for package advisories. Fixable HIGH/CRITICAL
findings block; full reports retain unfixed findings and remain available as
workflow artifacts. Scheduled/manual builds scan without publishing. A green
scan gate does not mean the image has no vulnerabilities. See
[Container security](https://github.com/emorgan33/worldforge/blob/main/docs/container-security.md)
for policy, remaining-risk review and local scan commands.

## Before every upgrade

1. Read all release notes between the installed and target versions.
2. Record the current tag or commit and container image.
3. Stop WorldForge and create a verified database-and-assets backup.
4. Confirm enough free disk space exists for the backup, new image, migration,
   and temporary files.
5. Note any release-specific backfill or configuration change.

Do not use an individual world export as the only pre-upgrade backup.

## Upgrade a published-image installation

Stay in the existing Compose directory and keep the same project name,
`worldforge-data` volume, and any reverse-proxy network overrides. Follow
[Backup and Restore](Backup-and-Restore) before changing the image. If its
helper commands use `worldforge:local`, substitute the exact image currently
deployed (published-image installations do not create that local tag).

Edit `.env` and change `WORLDFORGE_IMAGE` to the target version or digest from
the release notes. Then, for an install whose file is named `compose.yml`:

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs worldforge
```

If the file is still named `docker-compose.release.yml`, add
`-f docker-compose.release.yml` to **every** Compose command, including backup
commands, and include any proxy override with another `-f`. Do not use
`down --volumes` or change project names: either can lose access to your data.

Use [Installation](Installation) for the initial pull-only Compose setup.

## Upgrade a source-build installation tracking `main`

```bash
git fetch origin
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs worldforge
```

## Build from a release source tag

Replace `v0.4.3` with the intended release:

```bash
git fetch --tags
git checkout v0.4.3
docker compose up -d --build
docker compose ps
docker compose logs worldforge
```

The container validates configuration and runs `prisma migrate deploy` before
starting the application. A configuration failure occurs before migrations;
a migration failure leaves the service stopped and must be investigated rather
than bypassed.

Native installations run `pnpm install`, `pnpm sqlite:build` for the patched
SQLite runtime, `pnpm db:generate`, `pnpm db:deploy`, build, and restart using
the release's documented Node and pnpm versions. Ordinary dependency installation
alone does not apply the SQLite patch. Docker remains the supported self-hosting
path and builds the patched driver automatically.

## Verify after upgrading

- Confirm the health check and startup logs are clean.
- Confirm the running architecture matches the host
  (`docker compose exec worldforge node -p process.arch`); an ARM64 host must
  report `arm64`, not `x64` under emulation.
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

Maintainers should follow the repository's
[release publishing checklist](https://github.com/emorgan33/worldforge/blob/main/docs/releases/README.md).
It covers registry credentials, matching source tags and release-note files,
prerelease promotion, version reuse checks, and verifying the published image
before announcing it. Never include access tokens in release notes.

**Source owner:** `wiki/Upgrading-and-Releases.md`; adapted from
`docs/releases/`, `docs/deployment-configuration.md`, and
`docs/backup-restore.md`.
**Verified against:** `v0.4.3` (`94c694c`), published image/release metadata and
source audit. The release includes verified OS backports and embedded SQLite
3.54.1; 38 HIGH OS package matches remain unresolved, not suppressed. See
[Wiki Verification](Wiki-Verification) for executed rehearsals and limits.
Multi-platform selection and Oracle Ampere steps are source-reviewed; no
multi-platform release or Ampere VM was available for this update.
