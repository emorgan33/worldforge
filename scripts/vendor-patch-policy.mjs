/**
 * Pure evidence policy for reviewed container backports. The shell wrapper
 * collects facts from the exact image; this module decides whether they are
 * sufficient. Evidence is scoped to an architecture: a matching package version
 * never justifies reusing another architecture's disposition. Any uncertainty
 * is a failure, never a disposition.
 */
export function evaluateVendorEvidence(manifest, architecture, env) {
  const verified = [];
  const failures = [];

  if (typeof architecture !== "string" || !architecture) {
    return { verified, failures: ["An image architecture is required for vendor evidence."] };
  }
  const architectures = manifest?.architectures;
  if (!architectures || typeof architectures !== "object" || !Object.hasOwn(architectures, architecture)) {
    return { verified, failures: [`No reviewed vendor evidence for architecture ${architecture}.`] };
  }
  const platform = architectures[architecture];
  if (!platform || !Array.isArray(platform.packages) || !Array.isArray(platform.absentComponents)) {
    return { verified, failures: [`Malformed vendor evidence for architecture ${architecture}.`] };
  }

  for (const entry of platform.packages) {
    if (!entry || typeof entry !== "object" ||
        typeof entry.evidencePackage !== "string" ||
        !Array.isArray(entry.packages) || !entry.packages.length ||
        entry.packages.some((name) => typeof name !== "string" || !name) ||
        !Array.isArray(entry.cves) || !entry.cves.length ||
        entry.cves.some((cve) => typeof cve !== "string" || !cve)) {
      failures.push(`Malformed package evidence for architecture ${architecture}.`);
      continue;
    }
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

  for (const entry of platform.absentComponents) {
    if (!entry || typeof entry !== "object" ||
        typeof entry.cve !== "string" || !entry.cve ||
        !Array.isArray(entry.packages) || !entry.packages.length ||
        entry.packages.some((name) => typeof name !== "string" || !name)) {
      failures.push(`Malformed absent-component evidence for architecture ${architecture}.`);
      continue;
    }
    const files = entry.files ?? [];
    const perlModules = entry.perlModules ?? [];
    if (!Array.isArray(files) || !Array.isArray(perlModules) ||
        files.some((file) => typeof file !== "string" || !file) ||
        perlModules.some((moduleName) => typeof moduleName !== "string" || !moduleName) ||
        (files.length === 0 && perlModules.length === 0)) {
      failures.push(`Absent-component evidence for ${entry.cve} has no valid absence checks.`);
      continue;
    }
    let absent = true;
    for (const file of files) {
      if (env.exists(file)) {
        failures.push(`Expected absent file exists: ${file}`);
        absent = false;
      }
    }
    for (const moduleName of perlModules) {
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
