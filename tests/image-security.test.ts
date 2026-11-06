import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const checker = new URL("../scripts/check-image-vulnerabilities.mjs", import.meta.url);
function check(value: unknown, evidence?: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-scan-policy-"));
  try {
    const file = join(directory, "report.json");
    writeFileSync(file, JSON.stringify(value));
    const args = [checker.pathname, file];
    if (evidence !== undefined) {
      const evidenceFile = join(directory, "evidence.json");
      writeFileSync(evidenceFile, JSON.stringify(evidence));
      args.push(evidenceFile);
    }
    return spawnSync(process.execPath, args, { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function report(Severity: string, FixedVersion?: unknown) {
  return { SchemaVersion: 2, Results: [{ Class: "os-pkgs", Vulnerabilities: [{
    VulnerabilityID: "CVE-test", PkgName: "example", InstalledVersion: "1.0", Severity, FixedVersion,
  }] }] };
}
const verified = {
  verified: [{ cve: "CVE-test", package: "example", version: "1.0", reason: "vendor-backport", evidence: "https://example.invalid/evidence" }],
};

for (const severity of ["HIGH", "CRITICAL"]) {
  test(`blocks fixable ${severity} findings`, () => {
    const result = check(report(severity, "1.1"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CVE-test/);
  });
  test(`retains and warns about unresolved ${severity} findings`, () => {
    const result = check(report(severity));
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).unresolvedHighCritical, 1);
    assert.match(result.stderr, /does not certify/);
  });
}
test("accepts an exact version-matched vendor backport disposition", () => {
  const result = check(report("HIGH"), verified);
  assert.equal(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.unresolvedHighCritical, 0);
  assert.equal(body.vendorResolvedHighCritical, 1);
  assert.equal(body.vendorResolved[0].reason, "vendor-backport");
});
test("does not apply evidence to a different package version", () => {
  const mismatch = { verified: [{ ...verified.verified[0], version: "0.9" }] };
  const result = check(report("HIGH"), mismatch);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).unresolvedHighCritical, 1);
  assert.equal(JSON.parse(result.stdout).vendorResolvedHighCritical, 0);
});
test("fails closed on malformed vendor evidence", () => {
  for (const value of [{}, { verified: "bad" }, { verified: [{}] },
    { verified: [{ ...verified.verified[0], reason: "ignore" }] }]) {
    assert.equal(check(report("HIGH"), value).status, 1);
  }
});
test("reports lower severities without blocking", () => {
  const result = check(report("MEDIUM", "1.1"));
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).counts.MEDIUM, 1);
});
test("accepts an inspected target without findings", () => {
  assert.equal(check({ SchemaVersion: 2, Results: [{ Class: "os-pkgs" }] }).status, 0);
});
test("fails closed on absent, unsupported or malformed results", () => {
  for (const value of [{}, { SchemaVersion: 2, Results: [] }, { SchemaVersion: 1, Results: [] },
    { SchemaVersion: 2, Results: [{ Class: "unknown" }] },
    { SchemaVersion: 2, Results: [{ Class: "os-pkgs", Vulnerabilities: "bad" }] },
    { SchemaVersion: 2, Results: [{ Class: "os-pkgs", Vulnerabilities: [{}] }] },
    report("INVALID"), report("HIGH", 123)]) {
    assert.equal(check(value).status, 1);
  }
});

test("scanner failures cannot pass using a stale clean report", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-scan-failure-"));
  try {
    const scanner = join(directory, "scanner");
    const file = join(directory, "report.json");
    writeFileSync(scanner, "#!/bin/sh\nexit 2\n");
    chmodSync(scanner, 0o700);
    writeFileSync(file, JSON.stringify({ SchemaVersion: 2, Results: [{ Class: "os-pkgs" }] }));
    const script = new URL("../scripts/scan-image.sh", import.meta.url);
    const result = spawnSync("bash", [script.pathname, "test-image", file], {
      encoding: "utf8", env: { ...process.env, DOCKER_HOST: "unix:///unused", TRIVY_BIN: scanner },
    });
    assert.equal(result.status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
