# Contributing to WorldForge

Thanks for taking the time to contribute. This guide covers local setup, the
test workflow, and what we look for in pull requests.

## Prerequisites

- **Node.js 22+**
- **pnpm 10** (the pinned version in `package.json`; enable via
  `corepack enable`)
- **Docker** (optional, for the self-hosted stack and container testing)
- A C++ toolchain is not required; `sharp` ships prebuilt binaries.

## Local development setup

```bash
git clone https://github.com/emorgan33/worldforge.git
cd worldforge
pnpm install
cp .env.example .env
pnpm db:deploy        # apply migrations to prisma/dev.db
pnpm db:seed          # optional: load the sample "Aethelgard" world
pnpm dev
```

The dev server runs at http://localhost:3001 by default. If you change the
port, set `WORLDFORGE_ORIGIN` in `.env` to match, or write requests will be
rejected by the same-origin check.

### Signing in

Seeded users have **no password**. Generate a one-time setup link for the
seeded GM account (or a new account) with:

```bash
pnpm auth:setup
```

Open the printed `/setup#token=...` URL to set a password, then sign in at
`/login`. Passwords are stored as salted scrypt hashes (`src/lib/passwords.ts`).

### Database changes

- Edit `prisma/schema.prisma`, then create a migration:
  `pnpm exec prisma migrate dev --name <change>`.
- Commit the generated folder under `prisma/migrations/` with your change.
- Regenerate the client after pulling schema changes: `pnpm db:generate`.
  Restart the dev server afterwards; a running server can hold a stale Prisma
  client in memory.

## Testing

Unit tests and server-backed integration tests share one command:

```bash
pnpm test
```

Test files run serially. This matters because the integration suites share a
SQLite database with the dev server; parallel processes can race on the
rollback journal and produce spurious `disk I/O error` failures.

Many suites are **integration tests** that require a running dev server (not a
production build). Next.js 16.4.1 production builds do not reliably read Cookie
headers via `cookies()`, so use the dev server:

```bash
# terminal 1 — create an isolated database and asset directory
export TEST_ROOT="$(mktemp -d /tmp/worldforge-tests.XXXXXX)"
echo "Test root: $TEST_ROOT"
export DATABASE_URL="file:$TEST_ROOT/test.db?connection_limit=1"
export WORLD_CREATION_TEST_DATABASE_URL="$DATABASE_URL"
export WORLDFORGE_ASSET_DIR="$TEST_ROOT/assets"
mkdir -p "$WORLDFORGE_ASSET_DIR"
pnpm db:deploy
WORLDFORGE_ORIGIN=http://localhost:3131 pnpm exec next dev --port 3131

# terminal 2 — paste the TEST_ROOT path printed in terminal 1
export TEST_ROOT="/tmp/worldforge-tests.<unique-suffix>"
export DATABASE_URL="file:$TEST_ROOT/test.db?connection_limit=1"
export WORLD_CREATION_TEST_DATABASE_URL="$DATABASE_URL"
export WORLDFORGE_ASSET_DIR="$TEST_ROOT/assets"
WORLDFORGE_TEST_ORIGIN=http://localhost:3131 pnpm test
```

Use the exact `TEST_ROOT` value printed in terminal 1 in both terminals.
Absolute SQLite paths avoid different resolution between Prisma CLI and
generated-client test processes.
Never point tests at real data or run `pnpm db:seed` for the test workflow.
Tests that need the origin skip when `WORLDFORGE_TEST_ORIGIN` is unset; the
world-creation integration test also skips unless
`WORLD_CREATION_TEST_DATABASE_URL` is set.

## Before opening a pull request

Run all of these and make sure they pass:

```bash
pnpm lint
pnpm build
pnpm test        # unit suites; start the dev server first for integration
```

## Pull request expectations

- Keep changes focused; one logical change per pull request.
- Follow existing conventions in `src/lib` (framework-free domain logic) and
  `src/components` (UI). Match the surrounding style rather than introducing
  new patterns or libraries.
- Avoid comments unless they explain non-obvious intent. Prefer clear names.
- Update the relevant file in `docs/` when you change behavior. Design docs,
  not code comments, are how this project records decisions.
- Never commit `.env`, `prisma/*.db*`, uploaded assets in `data/assets/`, or
  any secret. See `SECURITY.md` for reporting vulnerabilities.
- Add or update tests for behavior changes.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js routes: pages (`/`, `/login`, `/w/...`, `/c/...`) and `src/app/api/` handlers |
| `src/components/` | React UI, grouped by feature |
| `src/lib/` | Domain logic, access control, Prisma access, import/export |
| `prisma/` | Schema, migrations, seed |
| `tests/` | Node test-runner suites |
| `docs/` | Feature and design documentation |

See `README.md` and `docs/feature-improvements.md` for the feature overview and
current status.

## A note on Next.js

This project uses a recent Next.js release with conventions that differ from
older documentation. Before writing Next.js code, read the guide for the
relevant area in `node_modules/next/dist/docs/`.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
