# Configuration

For source builds, copy `.env.example` to `.env`. For published-image Compose,
create `.env` using [Installation](Installation), including the image and origin.
Changes require the WorldForge
process or Compose service to be recreated unless noted otherwise.

## Deployment settings

| Variable | Default | Effect | Restart? |
| --- | --- | --- | --- |
| `WORLDFORGE_IMAGE` | None; required by `docker-compose.release.yml` | Published image such as `emorgan33/worldforge:VERSION`, or its release-noted digest. Use an actually published version; `VERSION` is a placeholder. Not used by the source-build Compose file. | Recreate service |
| `DATABASE_URL` | Local example: `file:./dev.db`; Compose forces `file:/data/worldforge.db` | Prisma SQLite URL. Relative paths resolve from `prisma/`. The production container requires a persistent file URL. | Yes |
| `WORLDFORGE_ASSET_DIR` | `./data/assets`; Compose forces `/data/assets` | Directory for uploaded and selected image files. It must persist with the database. | Yes |
| `WORLDFORGE_ORIGIN` | Unset in development; source-build Compose defaults to `http://localhost:3033`; release Compose requires an explicit value | Exact public origin used for same-origin write checks, secure cookies, setup/invitation URLs, and HSTS selection. Required in production. | Yes |
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

The remaining code-read variables are tooling, not server configuration:

| Variable | Default / effect | Restart? |
| --- | --- | --- |
| `CI` | Unset; enables CI-specific runner behavior | New tooling process |
| `WORLDFORGE_TEST_ORIGIN` | Unset; HTTP test origin (missing can skip tests) | New test process |
| `WORLDFORGE_PRODUCTION_TEST_ORIGIN` | Unset; production-auth smoke origin | New test process |
| `WORLD_CREATION_TEST_DATABASE_URL` | Unset; safety assertion, must equal isolated `DATABASE_URL` | New test process |
| `WORLD_TEST_TMP_ROOT` | Host temporary directory selected in testing instructions | New setup shell |
| `R17_ARTICLE_COUNT` | `2101`; article-count input to the R17 benchmark | New benchmark process |

Use [Testing and Isolated Databases](Testing-and-Isolated-Databases), never
production storage, for these settings. Standard platform variables such as
`PATH`, `HOME`, and `TMPDIR` are managed by the host/runtime rather than WorldForge.

## Origin rules

`WORLDFORGE_ORIGIN` must contain only the scheme, lowercase host, and optional
non-default port. Valid examples are `http://localhost:3033` and
`https://world.example`. A path, query, fragment, credentials, trailing slash,
uppercase hostname, or explicit default port causes container startup to fail.
Production permits HTTP only for localhost/loopback.

**Source owner:** `wiki/Configuration.md`; implementation authority is
`.env.example`, `docker-compose.yml`, `docker-compose.release.yml`, `scripts/docker-entrypoint.sh`, Prisma,
and `src/lib` environment reads.
**Verified against:** `v0.4.3` (`94c694c`), code-read environment inventory,
Compose configuration, and isolated runtime rehearsal; see
[Wiki Verification](Wiki-Verification).
