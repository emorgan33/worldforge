#!/bin/sh
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required (for example: file:/data/worldforge.db)." >&2
  exit 1
fi

if [ -n "${WORLDFORGE_ASSET_DIR:-}" ]; then
  mkdir -p "$WORLDFORGE_ASSET_DIR"
fi

echo "Applying database migrations..."
pnpm exec prisma migrate deploy

exec "$@"
