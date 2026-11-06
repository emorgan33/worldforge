#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: bash scripts/scan-image.sh IMAGE REPORT.json [VENDOR-EVIDENCE.json]}"
report="${2:?A full-report output path is required}"
evidence="${3:-}"
root=$(cd "$(dirname "$0")/.." && pwd)
export DOCKER_HOST="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
# Keep all severities and unfixed findings in the artifact. No ignore list is
# loaded; the separate policy check gates fixable findings and accepts only
# evidence verified from the exact image and package version.
"${TRIVY_BIN:-trivy}" image --image-src docker --scanners vuln \
  --ignorefile '' --ignore-unfixed=false --exit-code 0 \
  --format json --output "$report" "$image"
node "$root/scripts/check-image-vulnerabilities.mjs" "$report" ${evidence:+"$evidence"}
