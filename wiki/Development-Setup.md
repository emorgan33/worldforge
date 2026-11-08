# Development Setup

Docker is the supported self-hosting route. This page is for contributors working
on a separate checkout, never a running user's database. Use Node.js 22+ and the
`pnpm@10.34.9` pinned in `package.json` (Corepack or your package manager).

Follow the canonical [CONTRIBUTING setup](https://github.com/emorgan33/worldforge/blob/main/CONTRIBUTING.md#local-development-setup)
for cloning, dependencies, environment, migrations, and local startup. Generate
a setup link to sign in; seeded accounts have no password. Seeding is optional
and **replaces database contents**. Never run it against an existing campaign.

Important current-version details:

- `pnpm dev` uses Next.js's default port **3000** unless a port is explicitly
  supplied. Docker runs on **3033**. Match `WORLDFORGE_ORIGIN` to the browser's
  actual origin; do not assume a port from an older guide.
- The Prisma client-engine adapter needs `better-sqlite3`'s native module.
  Prebuilt binaries may be available; a source build needs a C/C++ toolchain and
  Python. Run `pnpm sqlite:build` for the patched SQLite used in production
  images (requires network access, unzip, OpenSSL, and build tools). Ordinary
  dependency installation is not the SQLite security patch.
- Run commands from the checkout root. Relative SQLite file URLs resolve under
  `prisma/`; app/config entry points load `.env` when needed.
- After schema changes, commit a migration, regenerate with `pnpm db:generate`,
  and restart development. Do not reseed to apply a migration.
- Read the installed Next.js guides in `node_modules/next/dist/docs/` before
  changing framework code. This project uses Next.js 16.4.5 and Cache Components.

Use [Testing and Isolated Databases](Testing-and-Isolated-Databases) for tests,
not your everyday development database. Keep `.env`, SQLite files, uploaded
assets, and tokens out of commits. Read [Architecture Overview](Architecture-Overview)
before changing authorization or persistence.

**Source owner:** `wiki/Development-Setup.md`; implementation:
`package.json`, `prisma.config.ts`, `src/lib/prisma-adapter.ts`, Dockerfile,
and `CONTRIBUTING.md`.
**Verified against:** `v0.4.3` (`94c694c`), source audit; see
[verification record](Wiki-Verification).
