#!/bin/sh
set -e

node <<'NODE'
const fail = (message) => {
  console.error(`WorldForge configuration error: ${message}`);
  process.exit(1);
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is required (for example: file:/data/worldforge.db).');
if (!databaseUrl.startsWith('file:') || databaseUrl === 'file:' || databaseUrl.startsWith('file::memory:')) {
  fail('DATABASE_URL must name a persistent SQLite file using file:/absolute/path.db or file:relative.db.');
}

const port = process.env.PORT ?? '3033';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  fail(`PORT must be an integer from 1 to 65535; received ${JSON.stringify(port)}.`);
}

const origin = process.env.WORLDFORGE_ORIGIN;
if (origin) {
  let parsed;
  try { parsed = new URL(origin); } catch { fail('WORLDFORGE_ORIGIN must be an absolute http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== origin) {
    fail('WORLDFORGE_ORIGIN must be canonical and contain only the public scheme, lowercase host, and optional non-default port (for example: https://world.example). Do not include a trailing slash.');
  }
}
NODE

if [ -n "${WORLDFORGE_ASSET_DIR:-}" ]; then
  mkdir -p "$WORLDFORGE_ASSET_DIR"
fi

echo "Applying database migrations..."
pnpm exec prisma migrate deploy

exec "$@"
