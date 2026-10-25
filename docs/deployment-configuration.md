# Deployment configuration

WorldForge reads its SQLite file from `DATABASE_URL`, its upload directory
from `WORLDFORGE_ASSET_DIR`, its public browser origin from
`WORLDFORGE_ORIGIN`, and its HTTP listen port from `PORT`.

| Setting | Default / example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` locally; `file:/data/worldforge.db` in Compose | Persistent SQLite database. Container startup requires a file-backed SQLite URL. |
| `WORLDFORGE_ASSET_DIR` | `./data/assets` locally; `/data/assets` in Compose | Persistent uploaded image directory. |
| `WORLDFORGE_ORIGIN` | Unset uses the request origin; Compose defaults to `http://localhost:3033` | Optional public origin used for write-request checks and generated links, especially behind a reverse proxy. It must be canonical: lowercase hostname, no trailing slash, and no explicit default port. |
| `PORT` | Next.js defaults to `3000`; Compose sets `3033` | HTTP listen port, read by `next start` from the process environment. |

Next.js chooses its listen port before loading `.env`; a `PORT` entry there has
no effect. To use port 3033 locally, run `PORT=3033 pnpm start` or
`pnpm exec next start --port 3033`, and set `WORLDFORGE_ORIGIN` to
`http://localhost:3033`. Plain `pnpm start` listens on port 3000 and should use
`http://localhost:3000`; with the setting unset, WorldForge uses that request
origin automatically.

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

The Docker entrypoint validates required SQLite configuration and the port
before migration. It prints a `WorldForge configuration error` with the
offending setting and an example when a value is malformed. A startup failure
before migration does not alter the database. Once configuration passes,
`prisma migrate deploy` applies pending migrations before the server starts;
this is the same path for an empty volume and an upgraded volume.

Compose stores the database and assets under the same `/data` volume. Back up
and restore those two paths together as documented in
[Backup and Restore](backup-restore.md). The shipped image currently runs the
entrypoint and server with the base image's default user. A non-root switch
needs an explicit persistent-volume ownership strategy and validation against
existing named volumes, so it is not enabled implicitly. The runtime image
includes SQLite's `sqlite3` CLI for recovery snapshots and integrity checks.
It also keeps the installed package tree intact: Prisma CLI is needed for runtime
migrations, and the setup/admin scripts and their runtime dependencies are
retained for operations.
