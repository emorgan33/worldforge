import { readFileSync } from "node:fs";

try {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const verificationPath = process.argv[3];
  const imageArchitecture = process.argv[4];
  const verified = new Map();
  if (verificationPath) {
    if (!imageArchitecture) throw new Error("An image architecture is required with vendor evidence.");
    const evidence = JSON.parse(readFileSync(verificationPath, "utf8"));
    if (typeof evidence.architecture !== "string" || !evidence.architecture) {
      throw new Error("Malformed vendor evidence architecture.");
    }
    if (evidence.architecture !== imageArchitecture) {
      throw new Error(`Vendor evidence architecture ${evidence.architecture} does not match image architecture ${imageArchitecture}.`);
    }
    if (!Array.isArray(evidence.verified)) throw new Error("Malformed vendor evidence.");
    for (const item of evidence.verified) {
      if (typeof item.cve !== "string" || typeof item.package !== "string" ||
          typeof item.version !== "string" || !["vendor-backport", "component-absent"].includes(item.reason)) {
        throw new Error("Malformed verified disposition.");
      }
      verified.set(`${item.cve}\0${item.package}\0${item.version}`, item);
    }
  }
  if (report.SchemaVersion !== 2 || !Array.isArray(report.Results) || report.Results.length === 0) {
    throw new Error("Missing or unsupported Trivy results.");
  }
  const counts = {};
  const blocked = [];
  const vendorResolved = [];
  let unfixedHighCritical = 0;
  for (const result of report.Results) {
    if (!["os-pkgs", "lang-pkgs"].includes(result.Class)) {
      throw new Error("Unexpected scan result class.");
    }
    const vulnerabilities = result.Vulnerabilities ?? [];
    if (!Array.isArray(vulnerabilities)) throw new Error("Malformed vulnerabilities.");
    for (const finding of vulnerabilities) {
      if (typeof finding.VulnerabilityID !== "string" || !finding.VulnerabilityID ||
          typeof finding.PkgName !== "string" || !finding.PkgName ||
          !["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(finding.Severity) ||
          (finding.FixedVersion != null && typeof finding.FixedVersion !== "string")) {
        throw new Error("Malformed vulnerability finding.");
      }
      counts[finding.Severity] = (counts[finding.Severity] ?? 0) + 1;
      if (["HIGH", "CRITICAL"].includes(finding.Severity)) {
        if (typeof finding.FixedVersion === "string" && finding.FixedVersion.trim()) {
          blocked.push(`${finding.Severity} ${finding.VulnerabilityID}: ${finding.PkgName} ${finding.InstalledVersion} -> ${finding.FixedVersion}`);
          continue;
        }
        const disposition = verified.get(`${finding.VulnerabilityID}\0${finding.PkgName}\0${finding.InstalledVersion}`);
        if (disposition) {
          vendorResolved.push({ severity: finding.Severity, cve: finding.VulnerabilityID, package: finding.PkgName,
            version: finding.InstalledVersion, reason: disposition.reason, evidence: disposition.evidence });
        } else {
          unfixedHighCritical += 1;
        }
      }
    }
  }
  console.log(JSON.stringify({ counts, fixableHighCritical: blocked.length, unresolvedHighCritical: unfixedHighCritical,
    vendorResolvedHighCritical: vendorResolved.length, vendorResolved }, null, 2));
  if (unfixedHighCritical) console.warn("HIGH/CRITICAL findings remain without scanner-listed fixes or verified vendor evidence; upstream patches may exist. This gate does not certify a vulnerability-free image.");
  if (blocked.length) {
    console.error(blocked.join("\n"));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Image scan failed: ${error.message}`);
  process.exitCode = 1;
}
