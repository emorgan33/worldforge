#!/usr/bin/env bash
set -euo pipefail

# Verify vendor backport evidence from the exact image being scanned. A package
# version is never enough: the installed changelog must name the CVE, sibling
# packages must share the patched source version, and absence claims must hold.
# Evidence is selected for the image's own architecture; another platform's
# reviewed disposition cannot be reused even when the installed versions match.
image="${1:?Usage: bash scripts/verify-vendor-patches.sh IMAGE OUTPUT.json}"
output="${2:?An output path is required}"
root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/scripts/vendor-security-patches.json"
test -f "$manifest"

image_arch=$(docker image inspect "$image" --format '{{.Architecture}}')
[[ -n "$image_arch" ]] || { echo "Could not determine the image architecture."; exit 1; }

encoded=$(base64 -w0 "$manifest")
docker run --rm --entrypoint sh "$image" -c '
set -eu
printf %s "$1" | base64 -d > /tmp/vendor-security-patches.json
node --input-type=module - <<'\''NODE'\''
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluateVendorEvidence } from "/app/scripts/vendor-patch-policy.mjs";

const manifest = JSON.parse(readFileSync("/tmp/vendor-security-patches.json", "utf8"));
const architecture = execFileSync("dpkg", ["--print-architecture"], { encoding: "utf8" }).trim();
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
const result = evaluateVendorEvidence(manifest, architecture, env);
if (result.failures.length) {
  console.error(result.failures.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ architecture, verified: result.verified }, null, 2));
NODE
' sh "$encoded" > "$output"

node -e '
const { readFileSync } = require("node:fs");
const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
const expected = process.argv[2];
if (typeof result.architecture !== "string" || !result.architecture) {
  console.error("Vendor patch verification did not record an image architecture.");
  process.exit(1);
}
if (result.architecture !== expected) {
  console.error(`Vendor evidence architecture ${result.architecture} does not match image architecture ${expected}.`);
  process.exit(1);
}
if (!Array.isArray(result.verified) || !result.verified.length) {
  console.error("Vendor patch verification produced no evidence.");
  process.exit(1);
}
console.log(`Verified ${result.verified.length} vendor/backport dispositions for ${result.architecture}.`);
' "$output" "$image_arch"
