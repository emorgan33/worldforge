# Night Watch validation — 2026-10-23

## Results

- Final full suite: **162 passed, 0 failed, 0 skipped** (59.6 seconds).
- `pnpm run lint`: exit 0, **6 warnings**, down from 29 at the start.
- `pnpm run build`: exit 0, including TypeScript and static page generation.
- No reset, commit, preview migration, or seed operation was performed.
- No credentials or `.env` contents were read or printed during this investigation.

Complete logs and the incoming working-tree patch are saved under
`.tmp-isolated/night-watch-audit-20261023/`. The verified preview backup is in
`.tmp-isolated/night-watch-audit-backup-20261023/`.

## Focused reproductions

Each named suite was run twice before changing project code. Tests used their
own disposable SQLite databases; a separate absolute temporary database URL
and asset directory were also supplied as a safety fallback.

The restricted runner obscured three setup errors. Running the files directly
under Node's test harness, with a temporary child-process error capture preload,
exposed their complete errors. Both forms are retained in the logs.

| Suite | Restricted result, twice | Outside sandbox, twice |
| --- | --- | --- |
| `foundry-import-service` | `spawnSync pnpm EPERM` during `prisma db push` | Pass |
| `world-creation-migration` | `spawnSync /home/erik/.nvm/versions/node/v24.17.0/bin/node EPERM` during `prisma migrate deploy` | Pass |
| `world-export-roundtrip` | `spawnSync pnpm EPERM` during `prisma migrate deploy`; both tests fail their shared setup hook | Pass |
| `world-management` | `spawnSync pnpm EPERM` during `prisma db push` | Pass |

These four original failures are sandbox process restrictions, not failed
application assertions. Replacing `pnpm` with Node alone would not solve the
restriction: the migration test already invokes Node directly.

Representative commands, run from the repository root with explicit temporary
database/assets paths and no test server origin:

```bash
node --require /tmp/worldforge-audit/capture-child-errors.cjs \
  --import tsx --test --test-concurrency=1 tests/foundry-import-service.test.tsx

# Direct form exposes setup errors suppressed by the restricted child runner:
node --require /tmp/worldforge-audit/capture-child-errors.cjs \
  --import tsx tests/world-creation-migration.test.tsx
```

The other two suite filenames were substituted in the same loop. Logs are named
`<suite>-restricted-<run>.log`, `<suite>-direct-restricted-<run>.log`, and
`<suite>-unrestricted-<run>.log`. The temporary preload is not part of project
code and is not enabled in the final test command.

## Isolated integration environment and actual setup defect

A source snapshot was created at `/tmp/worldforge-audit/current`, excluding all
`.env*` files. It shares installed dependencies through a symlink. Tests and the
dev server use the same absolute SQLite URL and isolated asset directory, as
required by `CONTRIBUTING.md`. The port-3002 preview and its `.next` output were
not used for these checks.

Turbopack refused the snapshot's dependency symlink because it leaves the
snapshot filesystem root. The isolated server therefore uses the documented
`next dev --webpack` option. This is a development server, not a production
server; production cookie behavior is not used as the integration-test signal.

```bash
# In /tmp/worldforge-audit/current, outside sandbox process/network restrictions:
export DATABASE_URL='file:/tmp/worldforge-audit/integration.db?connection_limit=1'
export WORLDFORGE_ASSET_DIR=/tmp/worldforge-audit/integration-assets
pnpm db:deploy
WORLDFORGE_ORIGIN=http://localhost:3131 \
  pnpm exec next dev --webpack --port 3131

# Separate terminal, same source snapshot and database:
export DATABASE_URL='file:/tmp/worldforge-audit/integration.db?connection_limit=1'
export WORLDFORGE_ASSET_DIR=/tmp/worldforge-audit/integration-assets
export WORLD_CREATION_TEST_DATABASE_URL="$DATABASE_URL"
WORLDFORGE_TEST_ORIGIN=http://localhost:3131 pnpm test
```

The first full run found a test portability defect: `world-management.test.tsx`
used a relative database URL. Its setup CLI resolves that URL relative to the
snapshot schema, while the shared generated Prisma client resolves it relative
to its original schema location. The setup created one database, then the test
queried another and received Prisma P2021: `The table main.User does not exist`.

This failure reproduced twice in the snapshot outside the sandbox. The test now
uses its already-computed absolute `databasePath`. The identical reproduction
passes twice after that one-line fix. Final full-suite validation passes all
162 tests, including the optional world-creation test.

Full logs: `full-before.log`, `full-final.log`, and
`world-management-snapshot-{before,after}-{1,2}.log`.

## Lint inventory and changes

An archived HEAD source tree was linted with the same installed dependencies.
It has 30 warnings. The incoming working tree has 29: 28 overlap HEAD, two HEAD
warnings had already been removed by the incoming Night Watch work, and the
anonymous PostCSS export is one new warning. Line numbers below refer to the
incoming lint log, not the final source.

| File | Initial warnings | Classification | Action |
| --- | ---: | --- | --- |
| `postcss.config.mjs` | 1 anonymous default export | Regression | Named the config before export |
| `prisma/seed.ts` | 5 unused result bindings | Pre-existing | Removed bindings; preserved awaited creation calls; seed was not run |
| `src/app/api/articles/[id]/route.ts` | 1 unused update result | Pre-existing | Preserved awaited update without unused binding |
| `src/app/api/assets/[id]/route.ts` | 1 unused import | Pre-existing | Removed import |
| `src/app/api/worlds/[id]/cleanup/route.ts` | 1 unused helper | Pre-existing | Removed helper |
| `src/app/api/worlds/[id]/members/route.ts` | 1 unused import | Pre-existing | Removed import |
| `src/app/api/worlds/[id]/preview/route.ts` | 1 unused parameter binding | Pre-existing | Removed unused DELETE route context binding |
| `src/app/invite/page.tsx` | 1 state update in effect | Pre-existing | Retained; see below |
| `src/components/CommandSearch.tsx` | 1 state update in effect | Pre-existing | Retained; see below |
| `src/components/article/ArticleViewer.tsx` | 2 raw images | Pre-existing | Retained; see below |
| `src/components/auth/AuthForm.tsx` | 1 state update in effect | Pre-existing | Retained; see below |
| `src/components/campaign/EntityRelationshipPicker.tsx` | 1 state update in effect | Pre-existing | Empty-query results are derived while rendering |
| `src/components/campaign/ShareResource.tsx` | 1 state update in effect | Pre-existing | Fetch result updates happen in the response callback; abort stale requests on cleanup |
| `src/components/map/InteractiveMap.tsx` | 1 raw image | Pre-existing | Retained; see below |
| `src/components/player/InviteClaimForm.tsx` | 1 state update in effect | Pre-existing | Missing-token error/loading presentation is derived from the token |
| `src/components/timeline/TimelineViewer.tsx` | 1 unused import | Pre-existing | Removed import |
| `src/components/variables/VariableManager.tsx` | 3 unused imports/prop binding | Pre-existing | Removed unused bindings; preserved prop type compatibility |
| `src/lib/access.ts` | 2 unused bindings | Pre-existing | Removed unused type import; explicitly retained the no-op predicate's actor argument for signature compatibility |
| `src/lib/world-appearance.ts` | 1 unused constant | Pre-existing | Removed constant |
| `tests/debug-auth.test.tsx` | 1 unused assertion import | Pre-existing | Replaced status logging with actual status assertions |
| `tests/player-access-api.test.tsx` | 1 unused fixture binding | Pre-existing | Removed unused authenticated fixture creation |

This pass resolves 23 warnings: 19 unused bindings, 3 effect/state warnings,
and the PostCSS regression. No ESLint rule was disabled or reconfigured.

The six deliberately retained warnings are:

- `src/app/invite/page.tsx:12` and `src/components/auth/AuthForm.tsx:9`:
  `react-hooks/set-state-in-effect`. These initialize state from a browser URL
  fragment and consume the token from the address bar. Changing that lifecycle
  needs dedicated hydration/Strict Mode coverage; adding timers just to silence
  the rule would not improve the design.
- `src/components/CommandSearch.tsx:85`:
  `react-hooks/set-state-in-effect`. The resets prevent old results and cursor
  state from surviving changes of search mode/world/filter. A response-state
  redesign needs focused search interaction coverage and is deferred.
- `src/components/article/ArticleViewer.tsx:83,304` and
  `src/components/map/InteractiveMap.tsx:325`: `@next/next/no-img-element`.
  These render user-selected article images and map canvases. Conversion needs
  decisions about arbitrary remote sources, intrinsic sizing, and map coordinate
  behavior. The existing rendering is preserved and the warnings remain visible.

Logs: `lint-before.log`, `lint-head.log`, `lint-final.log`.

## Production build

A separate current source snapshot at `/tmp/worldforge-audit/build` was used so
the build could not replace the active preview or test server's `.next` output.
No environment files were copied. Only an isolated build database was migrated.

```bash
export DATABASE_URL='file:/tmp/worldforge-audit/build.db?connection_limit=1'
export WORLDFORGE_ASSET_DIR=/tmp/worldforge-audit/build-assets
pnpm db:deploy
pnpm run build
```

The build passed outside the sandbox, with network access for the existing font
downloads. Log: `build-final.log`. Prisma CLI also emits its pre-existing
`package.json#prisma` deprecation notice; it is unrelated to the ESLint warnings
and does not require a Prisma version/config migration in this pass.

## Preview identity, backup, and approval-gated remediation

The host listener inspection identified PID **4037209** on port **3002**, with
working directory `/home/erik/worldforge`. Its open SQLite file descriptors
51, 91, and 95 all point to **`/home/erik/worldforge/prisma/dev.db`**. Process
environment contents were not read. PID/file descriptors must be rechecked
immediately before remediation because a restart can change them.

A read-only SQLite inspection found:

- `PRAGMA integrity_check`: `ok`.
- `PlayerInvitation` is absent; a read-only query reproduces
  `no such table: PlayerInvitation`, explaining Prisma P2021.
- Two pending migrations:
  `20261020030523_cascade_cleanup` and
  `20261021200000_player_invitations`.
- The earlier failed asset-cleanup migration attempt is marked rolled back and
  has a later successful application. It is not an unresolved failed migration.

SQLite's backup API made a consistent snapshot from a read-only source
connection; an asset archive was also created. Backup location:
`.tmp-isolated/night-watch-audit-backup-20261023/`.

- `preview.db`: 675840 bytes; SHA-256
  `f1933f88266a06e6773ce82e9b073872d8dd354220393162d973ff73ba8e4fb0`.
- `assets.tar.gz`: archive entries were read back successfully; SHA-256
  `237c45b86fb243f802c5eb4656ae9d97a8596211eb8782981dcd6a05cc821668`.
- Backup integrity: `ok`; foreign-key violations: **0**.

The two pending migrations were rehearsed with `pnpm db:deploy` against a
disposable copy of this backup. Both applied successfully. All 36 existing
table row counts were preserved, `PlayerInvitation` was created, integrity is
`ok`, and there are no foreign-key violations. Log: `upgrade-rehearsal.log`.

**The live preview database has not been migrated. Erik's approval is required
by the task's explicit database constraint.** After approval, the exact plan is:

1. Reconfirm the port-3002 process and open database path. Stop only that preview
   process gracefully, keeping the isolated test environment separate.
2. Refresh the database snapshot and asset archive to include any changes since
   this audit. Verify integrity, foreign keys, archive readability, and hashes.
3. From `/home/erik/worldforge`, apply the documented non-Docker upgrade command
   with an explicit database target:

   ```bash
   DATABASE_URL='file:/home/erik/worldforge/prisma/dev.db?connection_limit=1' \
     pnpm db:deploy
   ```

4. Verify both migrations are recorded as complete, `PlayerInvitation` exists,
   no pending migrations remain, and integrity/foreign-key checks pass. No reset,
   seeding, or migration-history repair is planned.
5. Restart the preview with its approved origin/server settings. Verify the
   invitations panel through an authenticated browser session. The generated
   Prisma client already includes `PlayerInvitation`; the missing table is the
   confirmed cause.
6. If deployment fails, keep the preview stopped and inspect the failure before
   any repair or restore. Restoring/replacing the live database requires explicit
   approval; the verified backup remains available.


## Approved preview upgrade completed

Erik approved the remediation after reviewing this report. On 2026-10-23:

- Reconfirmed PID 4037209 on port 3002 and its open database at
  `/home/erik/worldforge/prisma/dev.db`, then stopped that preview gracefully.
- Refreshed and verified the database/asset backups under
  `.tmp-isolated/preview-upgrade-20261023T122936Z/`. Hashes and table counts are
  recorded in that directory.
- Ran the explicit-target `pnpm db:deploy` command above successfully. Both
  pending migrations were applied.
- Verified integrity `ok`, zero foreign-key violations, all 36 existing table
  row counts preserved, no pending migrations, and `PlayerInvitation` present.
- Restarted the preview on port 3002 with the explicit database URL and
  hostname-based same-origin validation.
- A direct Prisma `playerInvitation.count()` query now succeeds without P2021.

No credentials or environment-file contents were inspected. Authenticated
browser verification of the invitations panel remains for an existing browser
session; no user sessions were read or synthesized for this check.

The old preview stopped listening after SIGTERM but remained alive and held
Next.js's startup lock. After confirming its identity and allowing graceful
shutdown, only that old PID was terminated with SIGKILL. The replacement
server started successfully; `/login` returned HTTP 200. Database integrity
and foreign-key checks were repeated successfully after the restart.


## Workspace-loading follow-up

After the migration, the preview served the authenticated workspace document
but no bootstrap API requests were visible from the affected browser session.
A fresh headless browser profile hydrated the login page without JavaScript
exceptions. Synthetic accounts in the isolated test database reached the
campaign desk under both webpack and a fresh Turbopack build; session, world,
all dataset, member, and invitation requests succeeded. Cold dev route
compilation outlasted an initial five-second sample, so the successful browser
checks used a longer observation window before fixture cleanup.

The preview's generated `.next/dev` directory was archived as
`.tmp-isolated/preview-dev-cache-20261023T124054Z/`, then regenerated by restarting
the preview against the same migrated database. The workspace route was warmed,
and the fresh-browser login hydration check passed. The user later confirmed a
fresh Firefox page still reported a failed HMR WebSocket and remained on the
campaign loader. The exact HMR URL returned `101 Switching Protocols` over both
IPv4 and IPv6, and a Node WebSocket client connected; this did not reproduce the
Firefox failure. An attempted Webpack dev restart did not resolve the browser
report. The workspace loader now falls back to a retryable error after 20
seconds if its startup effect is running but requests do not settle. No user
cookies, credentials, or account data were inspected.

Because Firefox continued to reject the dev HMR socket, port 3002 now serves
the optimized production build from `/tmp/worldforge-audit/build`. That build
was produced from the current source snapshot using the isolated build
database and asset directory; at runtime it uses the confirmed preview
database and `/home/erik/worldforge/data/assets`. The production page returns
HTTP 200 and `/_next/hmr` returns 404, confirming no HMR endpoint is involved.

## Final full-suite run

On October 23, 2026, the full suite passed with **162 passed, 0 failed, and 0
skipped**. It ran from an isolated source snapshot with a freshly migrated
SQLite database and temporary asset directory. The dev server and tests shared
that database, and `WORLD_CREATION_TEST_DATABASE_URL` was set so the optional
world-creation integration test ran. The isolated Turbopack server required a
temporary `turbopack.root` covering the snapshot and the repository's symlinked
dependencies; that test-only configuration was not added to the project.

An earlier full run against an isolated Webpack dev server intermittently
returned Next.js's `Manifest file is empty` error page during integration
requests. The appearance suite passed three consecutive focused repetitions,
and the complete suite passed under the isolated Turbopack server. No app code
was changed in response to that transient dev-server error.
