# Testing and Isolated Databases

Never run tests against a user's configured database or asset directory. Use the
complete two-terminal [isolated testing setup in CONTRIBUTING](https://github.com/emorgan33/worldforge/blob/main/CONTRIBUTING.md#testing).
Keep that file authoritative rather than copying a partial setup here.

## Required alignment

- `DATABASE_URL` must point at a dedicated absolute temporary SQLite file.
- `WORLD_CREATION_TEST_DATABASE_URL` must match it **exactly**.
- `WORLDFORGE_ASSET_DIR` must be a separate temporary asset directory.
- HTTP/browser server and test process must use the same storage, hostname,
  port, and origin. Set `WORLDFORGE_TEST_ORIGIN` to the isolated server.
- Run committed migrations on that isolated file. Do not seed test storage.
- Keep shared-database suites serial. Separate parallel jobs need separate files.

## Choose checks

| Command | Requires |
| --- | --- |
| `pnpm test:unit` | Logic/component environment; no HTTP server |
| `pnpm test:service` | Isolated SQLite and filesystem |
| `pnpm test:http` | Matching isolated running development server |
| `pnpm test:browser` | Same isolated server/storage plus Playwright Chromium |
| `pnpm test:production-auth` | Isolated `next start`; `WORLDFORGE_PRODUCTION_TEST_ORIGIN` |
| `pnpm lint`, `pnpm build` | Installed dependencies; build configuration |
| `pnpm docs:check` | Tracked wiki links, required pages, source/verification labels |

Missing variables can skip tests. Report skips explicitly; a skipped integration
test is not a pass. Browser traces can contain campaign data and credentials:
use only disposable fixtures and inspect artifacts before sharing.

The SQLite adapter serializes synchronous calls within a process, holding its
lock for whole transactions. Use adapter-backed clients, preserve independent
client race coverage, and do not weaken tests to bypass lock failures.

**Source owner:** `wiki/Testing-and-Isolated-Databases.md`; implementation:
`CONTRIBUTING.md`, `scripts/run-tests.mjs`, Playwright config, test fixtures, and CI.
**Verified against:** `v0.4.3` (`94c694c`), source/command inventory audit; see
[verification record](Wiki-Verification) for executed checks and limits.
