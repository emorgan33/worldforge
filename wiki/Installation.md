# Installation

Docker Compose is the supported self-hosting path. WorldForge requires
persistent storage for its SQLite database and uploaded assets.

## Requirements

- Docker Engine with the Compose plugin
- curl for downloading the published-image Compose file, or Git for source builds
- A reverse proxy and TLS certificate for a public deployment

## Install a published image (no Git checkout)

The image repository is `emorgan33/worldforge`. New releases from the
multi-platform workflow include **linux/amd64** and **linux/arm64** under the
same version/SHA tags; releases published before that support, including
**0.4.3** and **0.4.4**, are **linux/amd64 only**. Choose a version and digest
from a GitHub release whose **Release Docker image** workflow succeeded; older
releases may not have published images. Version **0.4.5** is published and
verified for both architectures; use it in the example below, or check the
release notes for a newer version and its matching Compose file.

Download the release's Compose file into a new directory:

```bash
mkdir worldforge && cd worldforge
curl -fsSLo compose.yml https://raw.githubusercontent.com/emorgan33/worldforge/v0.4.5/docker-compose.release.yml
```

Create `.env` alongside it with:

```dotenv
WORLDFORGE_IMAGE=emorgan33/worldforge:0.4.5
WORLDFORGE_ORIGIN=http://localhost:3033
WORLDFORGE_TRUSTED_PROXY=0
```

Then run:

```bash
docker compose pull
docker compose up -d --wait
docker compose exec worldforge pnpm auth:setup
```

Open `http://localhost:3033/login`. The same storage, HTTPS proxy, and backup
requirements below apply. Pin a version or the release's digest, not `latest`.
To upgrade, first stop and back up the database and assets together, change the
image in `.env`, pull, and start again with `up -d --wait`. Never remove the
data volume. A rollback may require restoring the matching backup.

For an existing deployment, preserve the Compose project name, named volume,
and proxy network configuration. An explicit `-f docker-compose.release.yml`
does not automatically load your existing proxy override; include it with a
second `-f` option. The source-build path below remains available.

See the repository [deployment guide](https://github.com/emorgan33/worldforge/blob/main/docs/deployment-configuration.md)
for release-publishing setup and the complete pull-and-run commands.

## Local installation

This path builds locally and requires Git; the published-image path above does not.

```bash
git clone https://github.com/emorgan33/worldforge.git
cd worldforge
cp .env.example .env
docker compose up -d --build
docker compose ps
```

The default binds `127.0.0.1:3033` and uses
`WORLDFORGE_ORIGIN=http://localhost:3033`. Create the first account with:

```bash
docker compose exec worldforge pnpm auth:setup
```

The named volume `worldforge-data` stores the database and assets under
`/data`. Removing or rebuilding the container does not remove that volume.

## Public HTTPS installation

Keep the application port private and place a reverse proxy on the same trusted
host or private network in front of it. In `.env`, set:

```dotenv
WORLDFORGE_ORIGIN="https://world.example"
WORLDFORGE_TRUSTED_PROXY="1"
WORLDFORGE_HOST_BIND="127.0.0.1"
```

The origin must be the exact browser-visible origin: lowercase hostname, no
path or trailing slash, and no explicit default port. Public HTTP origins are
rejected. Terminate TLS at the proxy and preserve the incoming `Host` value.

For login throttling, the proxy must remove any client-supplied
`X-WorldForge-Client-IP` and set it to the actual client address. With nginx,
the upstream location includes:

```nginx
proxy_set_header Host $host;
proxy_set_header X-WorldForge-Client-IP $remote_addr;
proxy_pass http://127.0.0.1:3033;
```

If another proxy sits in front of nginx, configure nginx's trusted real-IP
allowlist before using `$remote_addr`. Never expose port 3033 directly while
trusted-proxy mode is enabled.

## Oracle Cloud Ampere (ARM64)

WorldForge runs on native ARM64 Docker. Use a release whose notes list
`linux/arm64`; releases before multi-platform support, including `0.4.3`, are
AMD64-only. Do not use an emulated AMD64 image.

On an Oracle Ampere A1 instance running Ubuntu:

1. Install Docker Engine and the Compose plugin for ARM64 from Docker's
   supported packages, then confirm `uname -m` reports `aarch64`.
2. Allow inbound TCP 80/443 and SSH in the VCN security list. Do not expose
   port 3033 publicly; Compose binds it to loopback.
3. In `.env`, use the normal shared image reference and public HTTPS settings:
   ```dotenv
   WORLDFORGE_IMAGE=emorgan33/worldforge:X.Y.Z
   WORLDFORGE_ORIGIN=https://world.example
   WORLDFORGE_TRUSTED_PROXY=1
   WORLDFORGE_HOST_BIND=127.0.0.1
   ```
   `docker compose pull` selects ARM64 automatically; do not add a `platform:`
   override. The origin must be canonical (`https://world.example`, no trailing
   slash).
4. Start and verify the native platform, then create the first account:
   ```bash
   docker compose pull
   docker compose up -d --wait
   docker compose exec worldforge node -p process.arch   # arm64
   docker compose exec worldforge pnpm auth:setup
   ```
   Do not paste the setup URL or token into logs or screenshots.
5. Put the reverse proxy on the same host or a private network. Replace `Host`
   and overwrite `X-WorldForge-Client-IP`; see the nginx example above. If
   another proxy is in front, configure its trusted real-IP allowlist first.
6. Keep backups off the instance: stop WorldForge, back up the database and
   assets together, verify integrity, and copy the archive elsewhere. Oracle
   free-tier capacity is not guaranteed and idle instances may be reclaimed;
   the boot volume is not a backup.

The named volume holds `/data/worldforge.db` and `/data/assets`; preserve UID/GID
`10001` when reusing storage. See [Persistent storage](#persistent-storage) and
[Backup and Restore](Backup-and-Restore).

## Persistent storage

Compose mounts one named volume at `/data`:

- `/data/worldforge.db` — accounts, worlds, articles, sessions, and metadata
- `/data/assets` — uploaded and selected image files

Back up and restore them together. Existing bind mounts or volumes must be
writable by UID/GID `10001`. Before changing ownership, stop WorldForge and
take a backup; the complete migration command is in the repository
[deployment guide](https://github.com/emorgan33/worldforge/blob/main/docs/deployment-configuration.md).

## Upgrades

For a published image, take the same verified stopped-service backup, change
`WORLDFORGE_IMAGE` in `.env` to a published version/digest, and run
`docker compose pull` followed by `docker compose up -d --wait`. See
[Upgrading and Releases](Upgrading-and-Releases) for both deployment paths,
version selection, verification, and rollback.

For source builds:

1. Stop WorldForge and create a verified database-and-assets backup.
2. Pull the desired release or commit.
3. Rebuild and start the service:

   ```bash
   git pull --ff-only
   docker compose up -d --build
   docker compose logs worldforge
   ```

Container startup validates configuration, then runs `prisma migrate deploy`
before starting the server. Do not skip backups: migrations can make an older
application image incompatible with the upgraded database.

## Native development installation

Native Node installation is intended for contributors, not the supported
self-hosted production path. It requires Node.js 22 and pnpm 10. See
[CONTRIBUTING.md](https://github.com/emorgan33/worldforge/blob/main/CONTRIBUTING.md)
for the development and isolated-test setup.

See [Configuration](Configuration) for the complete setting reference and
[Troubleshooting](Troubleshooting) for startup failures.

**Source owner:** `wiki/Installation.md`; adapted from `README.md` and
`docs/deployment-configuration.md`.
**Verified against:** `v0.4.5` (`ab8b6be`), published-image Compose rehearsal on
AMD64; the published ARM64 child was pulled and executed under emulation; see
[Wiki Verification](Wiki-Verification). Proxy and Oracle Ampere guidance are
source-reviewed; no real TLS proxy or Oracle Ampere VM was available.
