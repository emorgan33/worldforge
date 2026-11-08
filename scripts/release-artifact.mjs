import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REVISION = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PLATFORMS = {
  "linux/amd64": "amd64",
  "linux/arm64": "arm64",
};
const MODES = new Set(["built", "reused"]);

function fail(message) {
  throw new Error(`Release artifact error: ${message}`);
}

export function validateArtifactMetadata(metadata) {
  const failures = [];
  if (!metadata || typeof metadata !== "object") return ["Artifact metadata is required."];
  if (typeof metadata.platform !== "string" || !Object.hasOwn(PLATFORMS, metadata.platform)) {
    failures.push("platform must be linux/amd64 or linux/arm64.");
  } else if (metadata.architecture !== PLATFORMS[metadata.platform]) {
    failures.push("architecture must match platform.");
  }
  if (typeof metadata.revision !== "string" || !REVISION.test(metadata.revision)) {
    failures.push("revision must be a full lowercase 40-character commit SHA.");
  }
  if (typeof metadata.imageId !== "string" || !DIGEST.test(metadata.imageId)) {
    failures.push("imageId must be a sha256 digest.");
  }
  if (typeof metadata.archiveSha256 !== "string" || !DIGEST.test(metadata.archiveSha256)) {
    failures.push("archiveSha256 must be a sha256 digest.");
  }
  if (!MODES.has(metadata.mode)) failures.push("mode must be built or reused.");
  if (typeof metadata.sourceDigest !== "string" || !DIGEST.test(metadata.sourceDigest)) {
    failures.push("sourceDigest must be a sha256 digest.");
  }
  return failures;
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

export function createArtifactMetadata({ platform, architecture, revision, imageId, archiveSha256, mode, sourceDigest }) {
  const metadata = { platform, architecture, revision, imageId, archiveSha256, mode, sourceDigest };
  const failures = validateArtifactMetadata(metadata);
  if (failures.length) fail(failures.join(" "));
  return metadata;
}

export async function verifyArtifact({ metadataPath, archivePath, platform, architecture, revision }) {
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    fail(`could not read metadata: ${error instanceof Error ? error.message : error}`);
  }
  const failures = validateArtifactMetadata(metadata);
  if (metadata?.platform !== platform) failures.push(`platform ${JSON.stringify(metadata?.platform)} does not match ${platform}.`);
  if (metadata?.architecture !== architecture) failures.push(`architecture ${JSON.stringify(metadata?.architecture)} does not match ${architecture}.`);
  if (metadata?.revision !== revision) failures.push(`revision ${JSON.stringify(metadata?.revision)} does not match ${revision}.`);
  const actual = await sha256File(archivePath).catch((error) => {
    fail(`could not read archive: ${error instanceof Error ? error.message : error}`);
  });
  if (actual !== metadata?.archiveSha256) {
    failures.push(`archive checksum ${actual} does not match ${JSON.stringify(metadata?.archiveSha256)}.`);
  }
  if (failures.length) fail(failures.join(" "));
  return metadata;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${JSON.stringify(argument)}.`);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  return values;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === "write") {
    for (const required of ["output", "archive", "platform", "architecture", "revision", "image-id", "mode", "source-digest"]) {
      if (!args[required]) throw new Error(`--${required} is required.`);
    }
    const archiveSha256 = await sha256File(args.archive);
    const metadata = createArtifactMetadata({
      platform: args.platform,
      architecture: args.architecture,
      revision: args.revision,
      imageId: args["image-id"],
      archiveSha256,
      mode: args.mode,
      sourceDigest: args["source-digest"],
    });
    writeFileSync(args.output, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Wrote ${args.output} (${metadata.platform}, ${metadata.archiveSha256}).`);
  } else if (command === "verify") {
    for (const required of ["metadata", "archive", "platform", "architecture", "revision"]) {
      if (!args[required]) throw new Error(`--${required} is required.`);
    }
    const metadata = await verifyArtifact({
      metadataPath: args.metadata,
      archivePath: args.archive,
      platform: args.platform,
      architecture: args.architecture,
      revision: args.revision,
    });
    console.log(`Verified ${metadata.platform} artifact at ${metadata.revision}.`);
  } else {
    throw new Error("Choose write or verify.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}