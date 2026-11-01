# Deployment configuration

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
