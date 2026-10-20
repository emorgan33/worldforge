# Local server lifecycle

The local production site runs at http://localhost:3033 under the systemd user manager. Use `pnpm serve:local` after building with `pnpm build`. This starts the existing production build as `worldforge.service`; running it again while active leaves the existing service alone.

The service owns the server independently of Codex tool/terminal sessions and uses Restart=on-failure with a three-second delay. Logs are retained by the journal rather than tied to a temporary tool session.

Commands:

```bash
systemctl --user status worldforge.service
journalctl --user -u worldforge.service -n 50
systemctl --user restart worldforge.service
systemctl --user stop worldforge.service
```

After a new build, restart the service to load it. The service is transient: it is not installed for boot startup, and an intentional stop is not automatically undone. Start it again with `pnpm serve:local` after a reboot or stop. The user manager must be available. Database and uploaded assets remain in their existing persistent locations.

## October 15 outage diagnosis

The reported unresponsive site was reproduced as connection refusal: there was no process listening on port 3033, and the previous tool process session no longer existed. No existing WorldForge service or recent user-journal failure was found. The old process's exit logs were unavailable, so a save-triggered crash could not be established.

The fix removes dependence on a temporary tool process. Verification after the launch command exited returned HTTP 200 and an active service. Isolated Chromium checks repeatedly saved both edition themes, changed campaign rules and reloaded author/reader pages successfully. The service remained running with zero restarts after those saves. Fixture records were removed. No application save logic or existing campaign records were changed.


### Dev server for testing

The table-access tests require the dev server (not the production build) because Next.js 16.4.1 Turbopack production builds do not reliably read Cookie headers via cookies() from next/headers.

Start: `WORLDFORGE_ORIGIN=http://localhost:3131 npx next dev --port 3131`
Disable systemd first: `systemctl --user disable --now worldforge.service`

Restart the dev server after `prisma generate` or a schema migration. A server started before client generation can keep the old Prisma model in memory even when the database and generated client on disk are current; `/api/worlds` then fails with `Unknown argument deletedAt`.

Run tests: `WORLDFORGE_TEST_ORIGIN=http://localhost:3131 node --import tsx --test tests/*.test.tsx`
