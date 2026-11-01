# Installation

Docker Compose is the supported self-hosting path. WorldForge requires
persistent storage for its SQLite database and uploaded assets.

## Requirements

- Git
- Docker Engine with the Compose plugin
- A reverse proxy and TLS certificate for a public deployment

## Local installation

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

## Persistent storage

Compose mounts one named volume at `/data`:

- `/data/worldforge.db` — accounts, worlds, articles, sessions, and metadata
- `/data/assets` — uploaded and selected image files

Back up and restore them together. Existing bind mounts or volumes must be
writable by UID/GID `10001`. Before changing ownership, stop WorldForge and
take a backup; the complete migration command is in the repository
[deployment guide](https://github.com/emorgan33/worldforge/blob/main/docs/deployment-configuration.md).

## Upgrades

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
**Verified against:** WorldForge commit `9050d94` (October 31, 2026).
