# Configuration

Copy `.env.example` to `.env` for Compose. Changes require the WorldForge
process or Compose service to be recreated unless noted otherwise.

## Deployment settings

| Variable | Default | Effect | Restart? |
| --- | --- | --- | --- |
| `DATABASE_URL` | Local example: `file:./dev.db`; Compose forces `file:/data/worldforge.db` | Prisma SQLite URL. Relative paths resolve from `prisma/`. The production container requires a persistent file URL. | Yes |
| `WORLDFORGE_ASSET_DIR` | `./data/assets`; Compose forces `/data/assets` | Directory for uploaded and selected image files. It must persist with the database. | Yes |
| `WORLDFORGE_ORIGIN` | Unset in development; `http://localhost:3033` in Compose | Exact public origin used for same-origin write checks, secure cookies, setup/invitation URLs, and HSTS selection. Required in production. | Yes |
| `WORLDFORGE_TRUSTED_PROXY` | `0` in Compose | Set to `1` only for public HTTPS behind a private proxy that overwrites `X-WorldForge-Client-IP`. | Yes |
| `WORLDFORGE_HOST_BIND` | `127.0.0.1` in Compose | Compose-only host interface for the published application port. | Recreate service |
| `WORLDFORGE_HOST_PORT` | `3033` | Compose-only host port mapped to container port 3033. | Recreate service |
| `PORT` | Next.js: `3000`; container: `3033` | Application listen port. Next.js chooses it before loading `.env`, so set it in the process environment or CLI. | Yes |

Compose deliberately overrides `DATABASE_URL`, `WORLDFORGE_ASSET_DIR`, and
`PORT` so all persistent content uses the named `/data` volume and the
container always listens on 3033.

## Stock-art operator settings

These are read by the application but are not needed for a normal installation.

| Variable | Default | Effect | Restart? |
| --- | --- | --- | --- |
| `WORLDFORGE_STOCK_ART_DIR` | `resources/stock-art` under the working directory | Overrides the curated stock-art catalog root. The production image supplies the bundled catalog. | Yes |
| `WORLDFORGE_STOCK_ART_ADVISORY` | `advisories.json` inside the stock-art root | Overrides the operator advisory file used by the stock-art advisory command. | For the running app, yes |

## Framework-managed settings

`NODE_ENV` is read by WorldForge and Next.js to choose development or
production behavior, logging, security requirements, and stock-art review
gates. Do not set it manually in `.env`; `next dev`, `next build`, and the
production image manage it.

`CI` and the `WORLDFORGE_TEST_*`, `WORLD_CREATION_TEST_DATABASE_URL`, and
`WORLD_TEST_TMP_ROOT` variables belong to test tooling rather than a deployed
WorldForge server. Their safe, isolated setup is documented in
[CONTRIBUTING.md](https://github.com/emorgan33/worldforge/blob/main/CONTRIBUTING.md).
`R17_ARTICLE_COUNT` is only a benchmark input.

## Origin rules

`WORLDFORGE_ORIGIN` must contain only the scheme, lowercase host, and optional
non-default port. Valid examples are `http://localhost:3033` and
`https://world.example`. A path, query, fragment, credentials, trailing slash,
uppercase hostname, or explicit default port causes container startup to fail.
Production permits HTTP only for localhost/loopback.

**Source owner:** `wiki/Configuration.md`; implementation authority is
`.env.example`, `docker-compose.yml`, `scripts/docker-entrypoint.sh`, Prisma,
and `src/lib` environment reads.  
**Verified against:** WorldForge commit `9050d94` (October 31, 2026).
