import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVendorEvidence } from "../scripts/vendor-patch-policy.mjs";

const manifest = {
  packages: [{
    evidencePackage: "sqlite3",
    packages: ["sqlite3", "libsqlite3-0"],
    cves: ["CVE-2026-119373"],
    evidence: "https://example.invalid/evidence",
  }],
  absentComponents: [{
    cve: "CVE-2026-9538",
    packages: ["perl-base"],
    files: ["/usr/share/perl5/Archive/Tar.pm"],
    perlModules: ["Archive::Tar"],
    evidence: "fixture",
  }],
};
function environment(overrides: Record<string, unknown> = {}) {
  return {
    dpkgVersion: (name: string) => name === "sqlite3" ? "1.0+dhi1" : "1.0+dhi1",
    changelog: () => "Backport CVE-2026-119373",
    exists: () => false,
    perlLoad: () => "missing",
    ...overrides,
  };
}
test("accepts exact sibling versions and specific module absence", () => {
  const result = evaluateVendorEvidence(manifest, environment());
  assert.deepEqual(result.failures, []);
  assert.equal(result.verified.length, 3);
});
test("rejects a sibling with a different installed version", () => {
  const result = evaluateVendorEvidence(manifest, environment({
    dpkgVersion: (name: string) => name === "libsqlite3-0" ? "0.9+dhi1" : "1.0+dhi1",
  }));
  assert.match(result.failures.join("\n"), /does not match evidence package/);
  assert.equal(result.verified.some((item: { package: string }) => item.package === "libsqlite3-0"), false);
});
test("rejects evidence missing the exact CVE", () => {
  const result = evaluateVendorEvidence(manifest, environment({ changelog: () => "No advisory here" }));
  assert.match(result.failures.join("\n"), /does not name CVE-2026-119373/);
});
test("rejects a loaded or unloadable Perl module instead of claiming absence", () => {
  for (const perlLoad of [() => "loaded", () => "error loading Archive::Tar"]) {
    const result = evaluateVendorEvidence(manifest, environment({ perlLoad }));
    assert.match(result.failures.join("\n"), /Cannot establish Archive::Tar absence/);
  }
});
