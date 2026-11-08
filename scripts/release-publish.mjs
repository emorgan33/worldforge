import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REVISION = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PLATFORMS = {
  "linux/amd64": "amd64",
  "linux/arm64": "arm64",
};
const SOURCES = new Set(["pushed", "existing"]);
const STAGING = /^staging-[0-9]+-[0-9]+-(amd64|arm64)$/;

function fail(message) {
  throw new Error(`Release publication error: ${message}`);
}

export function validatePublicationMetadata(metadata) {
  const failures = [];
  if (!metadata || typeof metadata !== "object") return ["Publication metadata is required."];
  if (typeof metadata.platform !== "string" || !Object.hasOwn(PLATFORMS, metadata.platform)) {
    failures.push("platform must be linux/amd64 or linux/arm64.");
  } else if (metadata.architecture !== PLATFORMS[metadata.platform]) {
    failures.push("architecture must match platform.");
  }
  if (typeof metadata.revision !== "string" || !REVISION.test(metadata.revision)) {
    failures.push("revision must be a full lowercase 40-character commit SHA.");
  }
  if (typeof metadata.childDigest !== "string" || !DIGEST.test(metadata.childDigest)) {
    failures.push("childDigest must be a sha256 digest.");
  }
  if (!SOURCES.has(metadata.source)) failures.push("source must be pushed or existing.");
  if (metadata.source === "pushed") {
    if (typeof metadata.stagingTag !== "string" || !STAGING.test(metadata.stagingTag)) {
      failures.push("pushed metadata requires a run-scoped staging tag.");
    } else if (!metadata.stagingTag.endsWith(`-${metadata.architecture}`)) {
      failures.push("staging tag must match the platform architecture.");
    }
  } else if (metadata.source === "existing" && metadata.stagingTag) {
    failures.push("existing metadata must not include a staging tag.");
  }
  return failures;
}

export function createPublicationMetadata({ platform, architecture, revision, childDigest, source, stagingTag }) {
  const metadata = { platform, architecture, revision, childDigest, source, stagingTag: stagingTag ?? "" };
  const failures = validatePublicationMetadata(metadata);
  if (failures.length) fail(failures.join(" "));
  return metadata;
}

export function verifyPublicationMetadata(metadata, { platform, architecture, revision, childDigest }) {
  const failures = validatePublicationMetadata(metadata);
  if (metadata?.platform !== platform) failures.push(`platform ${JSON.stringify(metadata?.platform)} does not match ${platform}.`);
  if (metadata?.architecture !== architecture) failures.push(`architecture ${JSON.stringify(metadata?.architecture)} does not match ${architecture}.`);
  if (metadata?.revision !== revision) failures.push(`revision ${JSON.stringify(metadata?.revision)} does not match ${revision}.`);
  if (childDigest && metadata?.childDigest !== childDigest) {
    failures.push(`childDigest ${JSON.stringify(metadata?.childDigest)} does not match ${childDigest}.`);
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
    for (const required of ["output", "platform", "architecture", "revision", "child-digest", "source"]) {
      if (!args[required]) throw new Error(`--${required} is required.`);
    }
    const metadata = createPublicationMetadata({
      platform: args.platform,
      architecture: args.architecture,
      revision: args.revision,
      childDigest: args["child-digest"],
      source: args.source,
      stagingTag: args["staging-tag"] ?? "",
    });
    writeFileSync(args.output, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Wrote ${args.output} (${metadata.platform}, ${metadata.childDigest}).`);
  } else if (command === "verify") {
    for (const required of ["metadata", "platform", "architecture", "revision"]) {
      if (!args[required]) throw new Error(`--${required} is required.`);
    }
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(args.metadata, "utf8"));
    } catch (error) {
      fail(`could not read metadata: ${error instanceof Error ? error.message : error}`);
    }
    const verified = verifyPublicationMetadata(metadata, {
      platform: args.platform,
      architecture: args.architecture,
      revision: args.revision,
      childDigest: args["child-digest"],
    });
    console.log(`Verified ${verified.platform} publication at ${verified.revision}.`);
  } else {
    throw new Error("Choose write or verify.");
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
