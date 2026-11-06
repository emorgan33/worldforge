#!/usr/bin/env bash
set -euo pipefail

# Verify vendor backport evidence from the exact image being scanned. A package
# version is never enough: the installed changelog must name the CVE, sibling
# packages must share the patched source version, and absence claims must hold.
image="${1:?Usage: bash scripts/verify-vendor-patches.sh IMAGE OUTPUT.json}"
output="${2:?An output path is required}"
root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/scripts/vendor-security-patches.json"
test -f "$manifest"

encoded=$(base64 -w0 "$manifest")
docker run --rm --entrypoint sh "$image" -c '
set -eu
printf %s "$1" | base64 -d > /tmp/vendor-security-patches.json
node --input-type=module - <<'\''NODE'\''
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluateVendorEvidence } from "/app/scripts/vendor-patch-policy.mjs";

const manifest = JSON.parse(readFileSync("/tmp/vendor-security-patches.json", "utf8"));
const env = {
  dpkgVersion(name) {
    return execFileSync("dpkg-query", ["-W", "-f=${Version}", name], { encoding: "utf8" }).trim();
  },
  changelog(name) {
    const path = `/usr/share/doc/${name}/changelog.Debian.gz`;
    if (!existsSync(path)) throw new Error(`Missing changelog for ${name}`);
    return execFileSync("zcat", [path], { encoding: "utf8" });
  },
  exists: existsSync,
  perlLoad(module) {
    try {
      execFileSync("perl", ["-M" + module, "-e", "1"], { stdio: "pipe" });
      return "loaded";
    } catch (error) {
      const stderr = String(error.stderr ?? "");
      const modulePath = module.replaceAll("::", "/") + ".pm";
      if (error.status === 2 && stderr.includes("locate " + modulePath)) return "missing";
      return `error loading ${module}`;
    }
  },
};
const result = evaluateVendorEvidence(manifest, env);
if (result.failures.length) {
  console.error(result.failures.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ verified: result.verified }, null, 2));
NODE
' sh "$encoded" > "$output"

node -e 'const r=require(process.argv[1]); if(!Array.isArray(r.verified)||!r.verified.length) { console.error("Vendor patch verification produced no evidence."); process.exit(1); } console.log(`Verified ${r.verified.length} vendor/backport dispositions.`);' "$output"
