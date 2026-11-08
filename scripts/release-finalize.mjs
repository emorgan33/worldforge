import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;
const STABLE_RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const START = "<!-- worldforge-image-release -->";
const END = "<!-- /worldforge-image-release -->";

function fail(message) {
  throw new Error(`Release finalization error: ${message}`);
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a sha256 digest.`);
}

function assertVersion(value) {
  if (typeof value !== "string" || !RELEASE_VERSION.test(value)) fail("version must be a release X.Y.Z or X.Y.Z-prerelease tag.");
}

export function shouldAdvanceLatest({ latestTag, releaseTag, prerelease }) {
  if (typeof prerelease !== "boolean") fail("prerelease must be a boolean.");
  if (typeof releaseTag !== "string" || !STABLE_RELEASE_TAG.test(releaseTag)) return false;
  if (typeof latestTag !== "string" || !STABLE_RELEASE_TAG.test(latestTag)) return false;
  return !prerelease && latestTag === releaseTag;
}

export function renderImageNotes({ image, version, indexDigest, amd64Digest, arm64Digest }) {
  if (typeof image !== "string" || !image || image.includes("://")) fail("image must be a repository name.");
  assertVersion(version);
  assertDigest(indexDigest, "indexDigest");
  assertDigest(amd64Digest, "amd64Digest");
  assertDigest(arm64Digest, "arm64Digest");
  return [
    START,
    "### Docker image (linux/amd64, linux/arm64)",
    "",
    `\`${image}:${version}\``,
    "",
    `Index digest: \`${indexDigest}\``,
    "",
    "Platform digests:",
    `- \`linux/amd64\`: \`${amd64Digest}\``,
    `- \`linux/arm64\`: \`${arm64Digest}\``,
    END,
  ].join("\n");
}

export function mergeImageNotes(body, block) {
  if (typeof body !== "string") fail("release body must be a string.");
  if (typeof block !== "string" || !block.includes(START) || !block.includes(END)) fail("image notes block is malformed.");
  const starts = body.split(START).length - 1;
  const ends = body.split(END).length - 1;
  if (starts !== ends || starts > 1) fail("release body has malformed or duplicate image notes markers.");
  let base = body;
  if (starts === 1) {
    const start = body.indexOf(START);
    const end = body.indexOf(END, start);
    if (end < start) fail("release body image notes markers are out of order.");
    base = `${body.slice(0, start)}${body.slice(end + END.length)}`;
  }
  const trimmed = base.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
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
  if (command === "latest") {
    if (args["latest-tag"] == null) throw new Error("--latest-tag is required (use an empty value when no stable release exists).");
    if (!args["release-tag"] || !args.prerelease) throw new Error("--release-tag and --prerelease are required.");
    const prerelease = args.prerelease === "true" ? true : args.prerelease === "false" ? false : fail("--prerelease must be true or false.");
    console.log(shouldAdvanceLatest({
      latestTag: args["latest-tag"],
      releaseTag: args["release-tag"],
      prerelease,
    }) ? "true" : "false");
  } else if (command === "notes") {
    for (const required of ["body", "output", "image", "version", "index-digest", "amd64-digest", "arm64-digest"]) {
      if (!args[required]) throw new Error(`--${required} is required.`);
    }
    const body = readFileSync(args.body, "utf8");
    const block = renderImageNotes({
      image: args.image,
      version: args.version,
      indexDigest: args["index-digest"],
      amd64Digest: args["amd64-digest"],
      arm64Digest: args["arm64-digest"],
    });
    writeFileSync(args.output, mergeImageNotes(body, block));
    console.log(`Wrote ${args.output}.`);
  } else {
    throw new Error("Choose latest or notes.");
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
