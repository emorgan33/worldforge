import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve(import.meta.dirname, "../scripts/check-production-boundary.sh");

function harness() {
  const bin = mkdtempSync(path.join(tmpdir(), "worldforge-boundary-"));
  const write = (name: string, body: string) => {
    const file = path.join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}`, "utf8");
    chmodSync(file, 0o755);
  };
  write("docker", `
case "$*" in
  *PortBindings*)
    if [ -n "\${STUB_BINDINGS_LINES:-}" ]; then printf '%b\\n' "$STUB_BINDINGS_LINES"; else printf '%s\\n' '127.0.0.1|3033'; fi
    ;;
  *.Config.Env*) printf '%s\\n' "WORLDFORGE_ORIGIN=https://example.test" "WORLDFORGE_TRUSTED_PROXY=1" ;;
  *.State.Health*) printf '%s\\n' "\${STUB_HEALTH:-healthy}" ;;
esac
exit 0
`);
  write("ss", `
printf '%s\\n' "State Recv-Q Send-Q Local-Address:Port Peer-Address:Port"
printf '%s\\n' "LISTEN 0 128 127.0.0.1:3033 0.0.0.0:*"
`);
  write("curl", `
case "$*" in
  *api/player/bookmarks*) printf 'HTTP/2 %s\\r\\ncache-control: private, no-store\\r\\n\\r\\n' "\${STUB_PRIVATE_STATUS:-401}" ;;
  *login*)
    printf 'HTTP/2 200\\r\\nstrict-transport-security: max-age=31536000\\r\\ncontent-security-policy: frame-ancestors none\\r\\nx-content-type-options: nosniff\\r\\n'
    [ "\${STUB_NO_XFO:-0}" = "1" ] || printf 'x-frame-options: DENY\\r\\n'
    printf '\\r\\n'
    ;;
esac
`);
  return {
    bin,
    run(url = "https://example.test", env: Record<string, string> = {}) {
      return spawnSync("bash", [script, url], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, ...env },
      });
    },
    cleanup() { rmSync(bin, { recursive: true, force: true }); },
  };
}

test("the boundary check passes a loopback, proxied, healthy deployment", () => {
  const h = harness();
  try {
    const result = h.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Boundary check passed/);
  } finally { h.cleanup(); }
});

test("IPv6-only and dual loopback bindings pass", () => {
  for (const bindings of ["::1|3033", "127.0.0.1|3033\\n::1|3033"]) {
    const h = harness();
    try {
      const result = h.run("https://example.test", { STUB_BINDINGS_LINES: bindings });
      assert.equal(result.status, 0, result.stderr);
    } finally { h.cleanup(); }
  }
});

test("a mixed loopback and wildcard binding fails the boundary check", () => {
  const h = harness();
  try {
    const result = h.run("https://example.test", {
      STUB_BINDINGS_LINES: "127.0.0.1|3033\n0.0.0.0|3033",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not loopback/);
  } finally { h.cleanup(); }
});

test("an HTTP URL is rejected before any request is made", () => {
  const h = harness();
  try {
    const result = h.run("http://example.test");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an https:\/\/ URL/);
  } finally { h.cleanup(); }
});

test("an unhealthy container fails the boundary check", () => {
  const h = harness();
  try {
    const result = h.run("https://example.test", { STUB_HEALTH: "unhealthy" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /health is 'unhealthy'/);
  } finally { h.cleanup(); }
});

test("an anonymous 200 from a private API fails the boundary check", () => {
  const h = harness();
  try {
    const result = h.run("https://example.test", { STUB_PRIVATE_STATUS: "200" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected 401/);
  } finally { h.cleanup(); }
});

test("a missing X-Frame-Options header fails the boundary check", () => {
  const h = harness();
  try {
    const result = h.run("https://example.test", { STUB_NO_XFO: "1" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /X-Frame-Options/);
  } finally { h.cleanup(); }
});
