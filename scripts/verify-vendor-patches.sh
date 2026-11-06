#!/usr/bin/env bash
set -euo pipefail

# Verify vendor backport evidence from the exact image being scanned. A package
# version is never enough: the installed changelog must name the CVE, and
# absence claims must hold inside the image.
image="${1:?Usage: bash scripts/verify-vendor-patches.sh IMAGE OUTPUT.json}"
output="${2:?An output path is required}"
root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/scripts/vendor-security-patches.json"
test -f "$manifest"

encoded=$(base64 -w0 "$manifest")
docker run --rm --entrypoint sh "$image" -c '
set -eu
printf %s "$1" | base64 -d > /tmp/vendor-security-patches.json
node --input-type=module - /tmp/vendor-security-patches.json <<'\''NODE'\''
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
const verified = [];
const failures = [];
const dpkgVersion = (name) => execFileSync("dpkg-query", ["-W", "-f=${Version}", name], { encoding: "utf8" }).trim();
const changelog = (name) => {
  const path = `/usr/share/doc/${name}/changelog.Debian.gz`;
  if (!existsSync(path)) throw new Error(`Missing changelog for ${name}`);
  return execFileSync("zcat", [path], { encoding: "utf8" }).replace(/\s+/g, "");
};

for (const entry of manifest.packages) {
  const text = changelog(entry.evidencePackage);
  for (const cve of entry.cves) {
    if (!text.includes(cve)) {
      failures.push(`${entry.evidencePackage} changelog does not name ${cve}`);
      continue;
    }
    for (const name of entry.packages) {
      verified.push({ cve, package: name, version: dpkgVersion(name), reason: "vendor-backport", evidence: entry.evidence });
    }
  }
}
for (const entry of manifest.absentComponents) {
  for (const file of entry.files ?? []) {
    if (existsSync(file)) failures.push(`Expected absent file exists: ${file}`);
  }
  for (const module of entry.perlModules ?? []) {
    try {
      execFileSync("perl", ["-M" + module, "-e", "1"], { stdio: "ignore" });
      failures.push(`Expected absent Perl module loads: ${module}`);
    } catch {}
  }
  for (const name of entry.packages) {
    verified.push({ cve: entry.cve, package: name, version: dpkgVersion(name), reason: "component-absent", evidence: entry.evidence });
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ verified }, null, 2));
NODE
' sh "$encoded" > "$output"

node -e 'const r=require(process.argv[1]); if(!Array.isArray(r.verified)||!r.verified.length) { console.error("Vendor patch verification produced no evidence."); process.exit(1); } console.log(`Verified ${r.verified.length} vendor/backport dispositions.`);' "$output"
