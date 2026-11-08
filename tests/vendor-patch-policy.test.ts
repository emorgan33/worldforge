import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVendorEvidence } from "../scripts/vendor-patch-policy.mjs";

const amd64PerlPath = "/usr/lib/x86_64-linux-gnu/perl5/5.40/Archive/Tar.pm";
const arm64PerlPath = "/usr/lib/aarch64-linux-gnu/perl5/5.40/Archive/Tar.pm";

function platform(evidence: string, perlPath: string) {
  return {
    packages: [{
      evidencePackage: "sqlite3",
      packages: ["sqlite3", "libsqlite3-0"],
      cves: ["CVE-2026-119373"],
      evidence,
    }],
    absentComponents: [{
      cve: "CVE-2026-9538",
      packages: ["perl-base"],
      files: ["/usr/share/perl5/Archive/Tar.pm", perlPath],
      perlModules: ["Archive::Tar"],
      evidence,
    }],
  };
}

const manifest = {
  architectures: {
    amd64: platform("https://example.invalid/amd64", amd64PerlPath),
    arm64: platform("https://example.invalid/arm64", arm64PerlPath),
  },
};

function environment(overrides: Record<string, unknown> = {}) {
  return {
    dpkgVersion: () => "1.0+dhi1",
    changelog: () => "Backport CVE-2026-119373",
    exists: () => false,
    perlLoad: () => "missing",
    ...overrides,
  };
}

test("accepts exact sibling versions and specific module absence", () => {
  const result = evaluateVendorEvidence(manifest, "amd64", environment());
  assert.deepEqual(result.failures, []);
  assert.equal(result.verified.length, 3);
});

test("verifies arm64 with its own reviewed evidence", () => {
  const result = evaluateVendorEvidence(manifest, "arm64", environment());
  assert.deepEqual(result.failures, []);
  assert.equal(result.verified.length, 3);
  assert.equal(result.verified[0].evidence, "https://example.invalid/arm64");
});

test("cannot reuse another architecture's evidence when versions match", () => {
  const amd64Only = { architectures: { amd64: manifest.architectures.amd64 } };
  const result = evaluateVendorEvidence(amd64Only, "arm64", environment());
  assert.match(result.failures.join("\n"), /No reviewed vendor evidence for architecture arm64/);
  assert.equal(result.verified.length, 0);
});

test("rejects an unsupported or missing image architecture", () => {
  for (const architecture of ["", "riscv64", undefined]) {
    const result = evaluateVendorEvidence(manifest, architecture, environment());
    assert.ok(result.failures.length, `expected failure for ${String(architecture)}`);
    assert.equal(result.verified.length, 0);
  }
});

test("uses the architecture-specific absence paths", () => {
  const arm64Result = evaluateVendorEvidence(manifest, "arm64", environment({
    exists: (file: string) => file === arm64PerlPath,
  }));
  assert.match(arm64Result.failures.join("\n"), /Expected absent file exists/);
  assert.equal(arm64Result.verified.some((item: { cve: string }) => item.cve === "CVE-2026-9538"), false);

  const amd64Result = evaluateVendorEvidence(manifest, "amd64", environment({
    exists: (file: string) => file === arm64PerlPath,
  }));
  assert.deepEqual(amd64Result.failures, []);
});

test("rejects a sibling with a different installed version", () => {
  const result = evaluateVendorEvidence(manifest, "amd64", environment({
    dpkgVersion: (name: string) => name === "libsqlite3-0" ? "0.9+dhi1" : "1.0+dhi1",
  }));
  assert.match(result.failures.join("\n"), /does not match evidence package/);
  assert.equal(result.verified.some((item: { package: string }) => item.package === "libsqlite3-0"), false);
});

test("rejects evidence missing the exact CVE", () => {
  const result = evaluateVendorEvidence(manifest, "amd64", environment({ changelog: () => "No advisory here" }));
  assert.match(result.failures.join("\n"), /does not name CVE-2026-119373/);
});

test("rejects a loaded or unloadable Perl module instead of claiming absence", () => {
  for (const perlLoad of [() => "loaded", () => "error loading Archive::Tar"]) {
    const result = evaluateVendorEvidence(manifest, "amd64", environment({ perlLoad }));
    assert.match(result.failures.join("\n"), /Cannot establish Archive::Tar absence/);
  }
});

test("fails closed on malformed architectures or platform sections", () => {
  for (const value of [null, {}, { architectures: {} },
    { architectures: { amd64: {} } },
    { architectures: { amd64: { packages: "bad", absentComponents: [] } } }]) {
    const result = evaluateVendorEvidence(value, "amd64", environment());
    assert.ok(result.failures.length, `expected failure for ${JSON.stringify(value)}`);
    assert.equal(result.verified.length, 0);
  }
});

test("rejects malformed package and absent-component entries", () => {
  for (const packages of [
    [{ evidencePackage: "sqlite3", packages: [], cves: ["CVE-2026-119373"] }],
    [{ evidencePackage: "sqlite3", packages: ["sqlite3"], cves: [] }],
    [{ evidencePackage: "sqlite3", packages: [""], cves: ["CVE-2026-119373"] }],
    [{ evidencePackage: "sqlite3", packages: ["sqlite3"], cves: [""] }],
  ]) {
    const value = { architectures: { amd64: { packages, absentComponents: [] } } };
    assert.match(
      evaluateVendorEvidence(value, "amd64", environment()).failures.join("\n"),
      /Malformed package evidence/,
    );
  }

  for (const absentComponents of [
    [{ packages: ["perl-base"] }],
    [{ cve: "CVE-2026-9538", packages: [] }],
    [{ cve: "CVE-2026-9538", packages: [""] }],
  ] as unknown[]) {
    const value = { architectures: { amd64: { packages: [], absentComponents } } };
    assert.match(
      evaluateVendorEvidence(value, "amd64", environment()).failures.join("\n"),
      /Malformed absent-component evidence/,
    );
  }
});

test("requires at least one valid absence check", () => {
  for (const absentComponents of [
    [{ cve: "CVE-2026-9538", packages: ["perl-base"] }],
    [{ cve: "CVE-2026-9538", packages: ["perl-base"], files: [], perlModules: [] }],
    [{ cve: "CVE-2026-9538", packages: ["perl-base"], files: "bad" }],
    [{ cve: "CVE-2026-9538", packages: ["perl-base"], files: [""] }],
    [{ cve: "CVE-2026-9538", packages: ["perl-base"], perlModules: [""] }],
  ] as unknown[]) {
    const value = { architectures: { amd64: { packages: [], absentComponents } } };
    const result = evaluateVendorEvidence(value, "amd64", environment());
    assert.match(result.failures.join("\n"), /no valid absence checks/);
    assert.equal(result.verified.length, 0);
  }
});
