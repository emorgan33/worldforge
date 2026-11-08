import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;
const SHA_TAG = /^sha-[0-9a-f]{40}$/;
const STAGING_INDEX = /^staging-index-[0-9]+-[0-9]+$/;
const MODES = new Set(["created", "existing"]);

function fail(message) {
  throw new Error(`Release index error: ${message}`);
}

function isVersionTag(tag) {
  return typeof tag === "string" && VERSION.test(tag);
}

function isShaTag(tag) {
  return typeof tag === "string" && SHA_TAG.test(tag);
}

export function validateTargets(expectedIndexDigest, targets) {
  const failures = [];
  if (typeof expectedIndexDigest !== "string" || !DIGEST.test(expectedIndexDigest)) {
    failures.push("expectedIndexDigest must be a sha256 digest.");
  }
  if (!Array.isArray(targets) || targets.length !== 2) {
    return [...failures, "exactly two targets are required."];
  }
  if (!targets.some((target) => isVersionTag(target?.tag))) failures.push("one version tag is required.");
  if (!targets.some((target) => isShaTag(target?.tag))) failures.push("one sha-<revision> tag is required.");
  const seen = new Set();
  for (const target of targets) {
    if (!target || typeof target !== "object" || (!isVersionTag(target.tag) && !isShaTag(target.tag))) {
      failures.push(`invalid target tag ${JSON.stringify(target?.tag)}.`);
      continue;
    }
    if (seen.has(target.tag)) failures.push(`duplicate target tag ${target.tag}.`);
    seen.add(target.tag);
    if (target.existingIndexDigest != null && !DIGEST.test(target.existingIndexDigest)) {
      failures.push(`invalid existing digest for ${target.tag}.`);
    }
  }
  return failures;
}

export function planIndexPublication({ expectedIndexDigest, targets }) {
  const failures = validateTargets(expectedIndexDigest, targets);
  if (Array.isArray(targets)) {
    for (const target of targets) {
      if (target?.existingIndexDigest && target.existingIndexDigest !== expectedIndexDigest) {
        failures.push(`${target.tag} already points to a different index ${target.existingIndexDigest}.`);
      }
    }
  }
  if (failures.length) return { valid: false, failures, actions: [] };
  const actions = targets.map((target) => ({
    tag: target.tag,
    action: target.existingIndexDigest ? "noop" : "create",
  }));
  return { valid: true, failures: [], actions };
}

export function verifyIndexPublication({ expectedIndexDigest, targets }) {
  const failures = validateTargets(expectedIndexDigest, targets);
  if (Array.isArray(targets)) {
    for (const target of targets) {
      if (!target?.existingIndexDigest) failures.push(`${target?.tag} does not point to an index.`);
      else if (target.existingIndexDigest !== expectedIndexDigest) {
        failures.push(`${target.tag} points to ${target.existingIndexDigest}, expected ${expectedIndexDigest}.`);
      }
    }
  }
  return { valid: failures.length === 0, failures };
}

export function validateReleaseIndexMetadata(metadata) {
  const failures = [];
  if (!metadata || typeof metadata !== "object") return ["Release index metadata is required."];
  if (!isVersionTag(metadata.version)) failures.push("version must be a release version tag.");
  if (typeof metadata.revision !== "string" || !REVISION.test(metadata.revision)) {
    failures.push("revision must be a full lowercase 40-character commit SHA.");
  }
  if (typeof metadata.indexDigest !== "string" || !DIGEST.test(metadata.indexDigest)) {
    failures.push("indexDigest must be a sha256 digest.");
  }
  if (typeof metadata.amd64Digest !== "string" || !DIGEST.test(metadata.amd64Digest)) {
    failures.push("amd64Digest must be a sha256 digest.");
  }
  if (typeof metadata.arm64Digest !== "string" || !DIGEST.test(metadata.arm64Digest)) {
    failures.push("arm64Digest must be a sha256 digest.");
  }
  if (!MODES.has(metadata.mode)) failures.push("mode must be created or existing.");
  if (metadata.mode === "created") {
    if (typeof metadata.stagingIndexTag !== "string" || !STAGING_INDEX.test(metadata.stagingIndexTag)) {
      failures.push("created metadata requires a run-scoped staging index tag.");
    }
  } else if (metadata.stagingIndexTag) {
    failures.push("existing metadata must not include a staging index tag.");
  }
  failures.push(...validateTargets(metadata.indexDigest, metadata.targets));
  if (Array.isArray(metadata.targets)) {
    for (const target of metadata.targets) {
      if (target?.existingIndexDigest !== metadata.indexDigest) {
        failures.push(`${target?.tag} does not point to the release index digest.`);
      }
    }
  }
  return failures;
}

export function createReleaseIndexMetadata({ version, revision, indexDigest, amd64Digest, arm64Digest, mode, stagingIndexTag, targets }) {
  const metadata = {
    version,
    revision,
    indexDigest,
    amd64Digest,
    arm64Digest,
    mode,
    stagingIndexTag: stagingIndexTag ?? "",
    targets,
  };
  const failures = validateReleaseIndexMetadata(metadata);
  if (failures.length) fail(failures.join(" "));
  return metadata;
}

function parseArgs(argv) {
  const values = { target: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${JSON.stringify(argument)}.`);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    const key = argument.slice(2);
    if (key === "target") values.target.push(value);
    else values[key] = value;
    index += 1;
  }
  return values;
}

function parseTargets(values) {
  return values.target.map((value) => {
    const separator = value.lastIndexOf("=");
    if (separator < 1) throw new Error(`Invalid --target ${JSON.stringify(value)}; expected tag=absent|sha256:...`);
    const tag = value.slice(0, separator);
    const digest = value.slice(separator + 1);
    return { tag, existingIndexDigest: digest === "absent" ? null : digest };
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const targets = parseTargets(args);
  if (command === "plan") {
    if (!args.expected || !args.output) throw new Error("--expected and --output are required.");
    const result = planIndexPublication({ expectedIndexDigest: args.expected, targets });
    writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) fail(result.failures.join(" "));
    console.log(`Release index plan validated for ${targets.length} targets.`);
  } else if (command === "verify") {
    if (!args.expected) throw new Error("--expected is required.");
    const result = verifyIndexPublication({ expectedIndexDigest: args.expected, targets });
    if (!result.valid) fail(result.failures.join(" "));
    console.log(`Release index verified for ${targets.length} targets.`);
  } else if (command === "write") {
    for (const required of ["output", "version", "revision", "index-digest", "amd64-digest", "arm64-digest", "mode"]) {
      if (!args[required]) throw new Error(`--${required} is required.`);
    }
    const metadata = createReleaseIndexMetadata({
      version: args.version,
      revision: args.revision,
      indexDigest: args["index-digest"],
      amd64Digest: args["amd64-digest"],
      arm64Digest: args["arm64-digest"],
      mode: args.mode,
      stagingIndexTag: args["staging-index-tag"] ?? "",
      targets,
    });
    writeFileSync(args.output, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Wrote ${args.output} (${metadata.indexDigest}).`);
  } else {
    throw new Error("Choose plan, verify or write.");
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
