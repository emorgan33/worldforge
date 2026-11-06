import { readFileSync } from "node:fs";

try {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (report.SchemaVersion !== 2 || !Array.isArray(report.Results) || report.Results.length === 0) {
    throw new Error("Missing or unsupported Trivy results.");
  }
  const counts = {};
  const blocked = [];
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
        } else {
          unfixedHighCritical += 1;
        }
      }
    }
  }
  console.log(JSON.stringify({ counts, fixableHighCritical: blocked.length, unfixedHighCritical }, null, 2));
  if (unfixedHighCritical) console.warn("HIGH/CRITICAL findings without a scanner-listed fixed version remain in the full report and require review; upstream patches may exist. This gate does not certify a vulnerability-free image.");
  if (blocked.length) {
    console.error(blocked.join("\n"));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Image scan failed: ${error.message}`);
  process.exitCode = 1;
}
