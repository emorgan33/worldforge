#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$project_dir/.next/BUILD_ID" ]]; then
  echo 'Build the site first with pnpm build.' >&2
  exit 1
fi
if systemctl --user is-active --quiet worldforge.service; then
  echo 'WorldForge is already running at http://localhost:3033'
  exit 0
fi

# The user service manager owns the server, so it survives terminal/tool sessions.
systemd-run --user --unit=worldforge --collect \
  --description='WorldForge local production server' \
  --property=Restart=on-failure --property=RestartSec=3 \
  --working-directory="$project_dir" \
  "$(command -v node)" "$project_dir/node_modules/next/dist/bin/next" start --hostname 0.0.0.0 --port 3033

echo 'WorldForge is starting at http://localhost:3033'
echo 'Logs: journalctl --user -u worldforge.service'
