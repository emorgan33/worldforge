/**
 * Pure evidence policy for reviewed container backports. The shell wrapper
 * collects facts from the exact image; this module decides whether they are
 * sufficient. Any uncertainty is a failure, never a disposition.
 */
export function evaluateVendorEvidence(manifest, env) {
  const verified = [];
  const failures = [];

  for (const entry of manifest.packages ?? []) {
    let evidenceVersion;
    let text;
    try {
      evidenceVersion = env.dpkgVersion(entry.evidencePackage);
      text = env.changelog(entry.evidencePackage).replace(/\s+/g, "");
    } catch (error) {
      failures.push(`${entry.evidencePackage}: ${error.message}`);
      continue;
    }
    for (const cve of entry.cves) {
      if (!text.includes(cve)) {
        failures.push(`${entry.evidencePackage} changelog does not name ${cve}`);
        continue;
      }
      for (const name of entry.packages) {
        let version;
        try {
          version = env.dpkgVersion(name);
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
          continue;
        }
        if (version !== evidenceVersion) {
          failures.push(`${name} ${version} does not match evidence package ${entry.evidencePackage} ${evidenceVersion}`);
          continue;
        }
        verified.push({ cve, package: name, version, reason: "vendor-backport", evidence: entry.evidence });
      }
    }
  }

  for (const entry of manifest.absentComponents ?? []) {
    let absent = true;
    for (const file of entry.files ?? []) {
      if (env.exists(file)) {
        failures.push(`Expected absent file exists: ${file}`);
        absent = false;
      }
    }
    for (const moduleName of entry.perlModules ?? []) {
      const result = env.perlLoad(moduleName);
      if (result !== "missing") {
        failures.push(`Cannot establish ${moduleName} absence: ${result}`);
        absent = false;
      }
    }
    if (!absent) continue;
    for (const name of entry.packages) {
      let version;
      try {
        version = env.dpkgVersion(name);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        continue;
      }
      verified.push({ cve: entry.cve, package: name, version, reason: "component-absent", evidence: entry.evidence });
    }
  }

  return { verified, failures };
}
