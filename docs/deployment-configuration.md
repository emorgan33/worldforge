# Deployment configuration

## Published Docker images

Release publishing targets **`emorgan33/worldforge`** on Docker Hub. Images are
available only after a GitHub release's **Release Docker image** workflow
succeeds; merging to `main` does not publish. Do not assume an older release
already has an image. Supported architecture initially: **linux/amd64**.

For an image version listed in its GitHub release notes, install without a
repository checkout (replace `VERSION` in both the URL and `.env` below with
that version, without `v`):

```bash
mkdir worldforge && cd worldforge
curl -fsSLo compose.yml https://raw.githubusercontent.com/emorgan33/worldforge/vVERSION/docker-compose.release.yml
cat > .env <<'EOF'
WORLDFORGE_IMAGE=emorgan33/worldforge:VERSION
WORLDFORGE_ORIGIN=http://localhost:3033
WORLDFORGE_TRUSTED_PROXY=0
EOF
# Edit .env to select an actually published version before running:
docker compose pull
docker compose up -d --wait
docker compose exec worldforge pnpm auth:setup
```

Open `http://localhost:3033/login` after completing the interactive account setup.
The Compose healthcheck verifies `/login`; startup applies pending migrations.
The `worldforge-data` volume contains both `/data/worldforge.db` and `/data/assets`.
Keep it across upgrades; never use `down --volumes` against real data. See the
origin/proxy and UID/GID `10001` requirements below for HTTPS or existing volumes.

Release `vX.Y.Z` publishes `emorgan33/worldforge:X.Y.Z` and a full-commit
`sha-<commit>` tag. `latest` tracks GitHub's current stable release, never a
prerelease. Pin a version, or the `emorgan33/worldforge@sha256:...` digest recorded
in the release notes, rather than `latest` for predictable upgrades. Release tags
must not be moved or reused; publish a new patch release for a correction.

Before upgrading, stop the service and take a verified **database plus assets**
backup using [Backup and restore](backup-restore.md). Change `WORLDFORGE_IMAGE`
in `.env`, then run `docker compose pull` and `docker compose up -d --wait`.
Check startup logs. An older image may not support a migrated database: rollback
requires restoring its matching database-and-assets backup as well.

To switch an existing source-build installation, keep its Compose **project
name**, existing named volume, `.env`, and reverse-proxy network settings. Run
with `-f docker-compose.release.yml` (and explicitly `-f` any proxy override).
Changing directories/project names silently creates a different, empty volume.
The original `docker-compose.yml` remains the local-build path:
`docker compose up -d --build`.

### Maintainer publishing

1. Create the public Docker Hub repository `emorgan33/worldforge`. Set GitHub
   Actions secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub token
   with write access). Never commit credentials.
2. Add `docs/releases/vX.Y.Z.md`, finish normal CI/review, and tag the intended
   reviewed commit `vX.Y.Z`. Publish its GitHub release with those notes. A plain
   tag push alone does not publish; drafts do not publish either. Mark
   prereleases as such.
3. `.github/workflows/docker-publish.yml` builds the release's exact source,
   tests fresh isolated storage via `scripts/smoke-release-image.sh`, pushes to
   Docker Hub, pulls and smoke-tests the published digest, then appends the
   version/digest to that release's notes. Observe the workflow to completion;
   a published GitHub release is not itself evidence of a published image.
4. Verify `docker pull emorgan33/worldforge:X.Y.Z` on a clean machine. Packaging
   pull requests also build and smoke-test without accessing registry secrets.

Release runs serialize their registry updates. Stable publications and
prerelease-to-stable promotions use the `released` event; prereleases use
`published` (including publication from a draft). Ordinary stable releases do
not publish twice. Promotions/retries reuse an existing version only after its
OCI revision label matches the tagged commit, then smoke-test it again. An
unexpected registry error fails closed rather than treating the tag as absent.
A failed run can leave a pushed version without updated notes or `latest`;
rerun only for the same unchanged release tag, then verify the final notes and
digest. No release or Docker Hub image is created merely by adding this workflow.

## Runtime settings

`WORLDFORGE_IMAGE` is required only by the pull-only Compose file and accepts
a published version tag or digest; the source-build file does not use it. The
release Compose file also requires an explicit `WORLDFORGE_ORIGIN`, whereas
the source-build file provides the local default shown below. For the complete
maintainer checklist, see [Release publishing](releases/README.md).

WorldForge reads its SQLite file from `DATABASE_URL`, its upload directory
from `WORLDFORGE_ASSET_DIR`, its public browser origin from
`WORLDFORGE_ORIGIN`, and its HTTP listen port from `PORT`.

| Setting | Default / example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` locally; `file:/data/worldforge.db` in Compose | Persistent SQLite database. Container startup requires a file-backed SQLite URL. |
| `WORLDFORGE_ASSET_DIR` | `./data/assets` locally; `/data/assets` in Compose | Persistent uploaded image directory. |
| `WORLDFORGE_ORIGIN` | Unset in development; Compose defaults to `http://localhost:3033` | Required for production writes and container startup. It must be canonical: lowercase hostname, no trailing slash, and no explicit default port. Production HTTP is allowed only for localhost or loopback. |
| `WORLDFORGE_TRUSTED_PROXY` | `0` in Compose | Set to `1` for public HTTPS deployments behind a private proxy that overwrites `X-WorldForge-Client-IP` with the actual client IP. |
| `WORLDFORGE_HOST_BIND` | `127.0.0.1` in Compose | Host interface for the container port. Keep it on loopback when a local reverse proxy fronts the app. |
| `PORT` | Next.js defaults to `3000`; Compose sets `3033` | HTTP listen port, read by `next start` from the process environment. |

Next.js chooses its listen port before loading `.env`; a `PORT` entry there has
no effect. To use port 3033 locally, run `PORT=3033 pnpm start` or
`pnpm exec next start --port 3033`, and set `WORLDFORGE_ORIGIN` to
`http://localhost:3033`. Plain `pnpm start` listens on port 3000 and should use
`http://localhost:3000`; with the setting unset, WorldForge uses that request
origin automatically in development. Production requires an explicit origin.

For a reverse proxy, set `WORLDFORGE_ORIGIN` to the browser-visible HTTPS
origin even when the app listens on an internal HTTP port. Origin values must
be canonical because write checks compare the browser's serialized origin to
the configured value. For example, use `https://example.com`, not
`https://example.com/`, `https://EXAMPLE.com`, or
`https://example.com:443`. The container rejects noncanonical origins before
migrations. In Compose, the container listens on port 3033; set
`WORLDFORGE_HOST_PORT` to change the host
side port, and set `WORLDFORGE_ORIGIN` to the matching public URL. The default
is `http://localhost:3033`.

Public HTTPS deployments also set `WORLDFORGE_TRUSTED_PROXY=1`. The reverse
proxy must overwrite `X-WorldForge-Client-IP` from its actual connection
address, remove any client-supplied copy, and keep the app port inaccessible to
untrusted clients. For nginx, use
`proxy_set_header X-WorldForge-Client-IP $remote_addr;` on the upstream
location. If nginx itself has another trusted proxy in front, configure its
real-IP allowlist first. WorldForge validates the header as one IP address and
refuses login when it is missing. It ignores `X-Forwarded-For` for rate limiting.
Login attempt limits are 8 per account and source, and 30 per source, per 15
minutes. A source that exhausts its budget cannot force a different source to
wait. Local development accepts the dedicated header for fixture testing;
production accepts it only when the trusted-proxy setting is enabled.

The Docker entrypoint validates required SQLite configuration and the port
before migration. It also requires a canonical public origin; HTTP is reserved
for local loopback deployments. It prints a `WorldForge configuration error` with the
offending setting and an example when a value is malformed. A startup failure
before migration does not alter the database. Once configuration passes,
`prisma migrate deploy` applies pending migrations before the server starts;
this is the same path for an empty volume and an upgraded volume.

The app sets clickjacking, nosniff, referrer and CSP response headers. The CSP
allows inline Next.js scripts and reader CSS, and HTTPS images used in articles
and custom CSS. HSTS is sent only when `WORLDFORGE_ORIGIN` is HTTPS. TLS is
terminated at the reverse proxy; configure the proxy to replace the incoming
Host header and remove untrusted forwarding headers. Login throttling uses only
the dedicated, proxy-overwritten client address header in this mode.
Keep the app's internal port private when using a reverse proxy.

Compose stores the database and assets under the same `/data` volume. Back up
and restore those two paths together as documented in
[Backup and Restore](backup-restore.md). The runtime image uses UID/GID 10001 for both
startup migrations and the server. A new named volume inherits ownership from
the image. Before starting this image with an existing volume, stop the service,
back up the volume, then run
`docker compose run --rm --no-deps --user root --entrypoint sh worldforge -c 'chown -R 10001:10001 /data'`.
For bind mounts, assign the same ownership on the host. The runtime image
includes SQLite's `sqlite3` CLI for recovery snapshots and integrity checks.
It also keeps the installed package tree intact: Prisma CLI is needed for runtime
migrations, and the setup/admin scripts and their runtime dependencies are
retained for operations.
