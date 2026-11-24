#!/usr/bin/env bash
# Read-only verification of the public deployment boundary.
#
#   bash scripts/check-production-boundary.sh https://worldforge.example.com
#
# Checks that the application port is loopback-only, that no duplicate local
# server is listening, that the container is configured for a trusted HTTPS
# proxy, and that public responses carry the expected security headers and
# private caching directives. It does not change configuration or data.
set -euo pipefail

url="${1:-${WORLDFORGE_PUBLIC_URL:-https://worldforge.deskt.theworkpc.com}}"
container="${WORLDFORGE_CONTAINER:-worldforge-worldforge-1}"
failures=0
warnings=0

fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
warn() { echo "WARN: $*" >&2; warnings=$((warnings + 1)); }
ok() { echo "ok: $*"; }

loopback_address() {
  case "$1" in
    127.*|\[::1\]:*|localhost:*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Container port and proxy configuration ---------------------------------
if command -v docker >/dev/null 2>&1 && docker inspect "$container" >/dev/null 2>&1; then
  bindings=$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')
  host_ip=$(printf '%s' "$bindings" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("3033/tcp",[{}])[0].get("HostIp",""))')
  if [ "$host_ip" = "127.0.0.1" ] || [ "$host_ip" = "::1" ]; then
    ok "container port 3033 is bound to loopback ($host_ip)"
  else
    fail "container port 3033 is published on '${host_ip:-<all interfaces>}'; bind it to 127.0.0.1"
  fi

  envs=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}')
  origin=$(printf '%s\n' "$envs" | sed -n 's/^WORLDFORGE_ORIGIN=//p')
  proxy=$(printf '%s\n' "$envs" | sed -n 's/^WORLDFORGE_TRUSTED_PROXY=//p')
  case "$origin" in
    https://*) ok "WORLDFORGE_ORIGIN is HTTPS ($origin)" ;;
    *) fail "WORLDFORGE_ORIGIN must be the canonical HTTPS origin (found '${origin:-unset}')" ;;
  esac
  [ "$proxy" = "1" ] && ok "WORLDFORGE_TRUSTED_PROXY=1" || fail "WORLDFORGE_TRUSTED_PROXY must be 1 behind the proxy (found '${proxy:-unset}')"
  [ "$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null)" = "healthy" ] && ok "container is healthy" || warn "container health status is not 'healthy'"
else
  warn "container '$container' not found locally; skipped Docker checks"
fi

# --- Local listeners ---------------------------------------------------------
if command -v ss >/dev/null 2>&1; then
  addresses=$(ss -ltn 2>/dev/null | awk 'NR > 1 && $4 ~ /:3033$/ { print $4 }')
  if [ -z "$addresses" ]; then
    warn "nothing listens on :3033 locally; is the application running?"
  else
    while IFS= read -r address; do
      [ -z "$address" ] && continue
      if loopback_address "$address"; then ok "app listener $address is loopback-only"; else fail "app listener $address is reachable off-host"; fi
    done <<< "$addresses"
  fi
  if ss -ltn 2>/dev/null | awk 'NR > 1 && $4 ~ /:3035$/ { found=1 } END { exit found ? 0 : 1 }'; then
    fail "a duplicate local server is listening on :3035; stop it so only the proxied production server runs"
  else
    ok "no duplicate server on :3035"
  fi
else
  warn "ss is unavailable; skipped listener checks"
fi

# --- Public HTTPS headers ----------------------------------------------------
headers=$(curl -fsS --max-time 20 -D - -o /dev/null "$url/login" 2>/dev/null) || { fail "cannot fetch $url/login over verified HTTPS"; headers=""; }
if [ -n "$headers" ]; then
  grep -qi '^strict-transport-security:' <<< "$headers" && ok "HSTS header present" || fail "missing Strict-Transport-Security on HTTPS responses"
  grep -qi 'content-security-policy:.*frame-ancestors' <<< "$headers" && ok "CSP with frame-ancestors present" || fail "missing CSP frame-ancestors"
  grep -qi '^x-content-type-options: *nosniff' <<< "$headers" && ok "nosniff header present" || fail "missing X-Content-Type-Options: nosniff"
  grep -qi '^x-frame-options: *DENY' <<< "$headers" && ok "X-Frame-Options: DENY present" || warn "X-Frame-Options missing or not DENY (CSP frame-ancestors still applies)"
fi

private_headers=$(curl -sS --max-time 20 -D - -o /dev/null "$url/api/player/bookmarks" 2>/dev/null) || true
status=$(printf '%s' "$private_headers" | awk 'NR == 1 { print $2 }')
if [ "$status" = "401" ]; then ok "anonymous private API is rejected"; else warn "anonymous /api/player/bookmarks returned ${status:-no status}; expected 401"; fi
grep -qi 'cache-control:.*no-store' <<< "$private_headers" && ok "private response is not cacheable" || fail "private API response lacks Cache-Control: no-store"

echo
if [ "$failures" -gt 0 ]; then
  echo "Boundary check failed: $failures failure(s), $warnings warning(s)."
  exit 1
fi
echo "Boundary check passed ($warnings warning(s))."
