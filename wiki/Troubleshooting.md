# Troubleshooting

Start with `docker compose ps` and the service log:

```bash
docker compose ps
docker compose logs --tail=200 worldforge
```

## The container will not start

Messages beginning with `WorldForge configuration error` identify the invalid
setting before migrations run.

- Confirm `WORLDFORGE_ORIGIN` has no trailing slash or path and exactly matches
  the browser-visible origin.
- Public deployments require HTTPS and `WORLDFORGE_TRUSTED_PROXY=1`.
- `DATABASE_URL` in the container must be a persistent `file:` SQLite URL.
- `PORT` must be an integer from 1 through 65535.

If migrations fail, keep the service stopped, preserve the database and assets,
and inspect the full log. Do not delete the volume to make startup pass.

## Writes return 403

The browser origin does not match `WORLDFORGE_ORIGIN`. Include the actual scheme
and non-default port, omit the trailing slash, recreate the service, and access
WorldForge only through that URL.

## Public HTTPS login returns 503

WorldForge requires a trustworthy client address for login throttling. Verify
all three conditions:

1. `WORLDFORGE_TRUSTED_PROXY=1` is set.
2. The proxy overwrites `X-WorldForge-Client-IP` with one valid client IP.
3. The application port is inaccessible to untrusted clients.

WorldForge intentionally does not use `X-Forwarded-For` for this purpose.

## The setup link is missing or expired

Generate another one-time link inside the running container:

```bash
docker compose exec worldforge pnpm auth:setup -- you@example.com
```

For a new account, use `pnpm auth:setup -- --create you@example.com`. Treat the
fragment token in the printed URL as a password and do not publish it.

## Uploaded images disappear after a rebuild

Confirm the service still mounts `worldforge-data` at `/data` and that
`WORLDFORGE_ASSET_DIR` is `/data/assets` inside the container. The database and
asset directory must come from the same recovery point. A database record
without its matching asset file cannot reconstruct the image.

## Uploads fail with a permission error

The production container runs as UID/GID `10001`. Stop the service and take a
backup before correcting an existing volume or bind mount. Follow the ownership
procedure in the repository
[deployment guide](https://github.com/emorgan33/worldforge/blob/main/docs/deployment-configuration.md).

## The browser cannot connect

The default Compose binding is loopback-only (`127.0.0.1:3033`). This is
intentional. For access from another machine, deploy a reverse proxy with TLS;
do not simply expose the trusted application port to the internet.

## Database errors after a restore

Stop the service. Verify the restored SQLite file with `PRAGMA integrity_check`
and ensure its matching assets were restored. Never restore over a running
server or mix a database and asset directory from different backups. Use the
repository's complete
[backup and restore guide](https://github.com/emorgan33/worldforge/blob/main/docs/backup-restore.md).

When opening an issue, include the WorldForge commit/release, deployment method,
sanitized error text, and relevant logs. Remove emails, setup/invitation tokens,
private article content, domains you do not want public, and other secrets.

**Source owner:** `wiki/Troubleshooting.md`; adapted from
`docs/deployment-configuration.md`, `docs/backup-restore.md`, and current auth
behavior.  
**Verified against:** WorldForge commit `9050d94` (October 31, 2026).
