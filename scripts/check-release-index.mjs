import { appendFileSync } from "node:fs";
import { resolveRelease } from "./docker-release-registry.mjs";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${JSON.stringify(argument)}.`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function dockerHubRepository(image) {
  if (typeof image !== "string" || !image || image.includes("://")) {
    throw new Error("--image must be a Docker Hub repository such as emorgan33/worldforge.");
  }
  const repository = image.replace(/^docker\.io\//, "").replace(/^index\.docker\.io\//, "");
  const first = repository.split("/")[0];
  if (repository.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost")) {
    throw new Error("Only Docker Hub repositories are supported by this check.");
  }
  return repository;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = dockerHubRepository(args.image);
  const tag = args.tag;
  const revision = args.revision;
  if (!tag) throw new Error("--tag is required.");
  if (!revision) throw new Error("--revision is required.");
  const expectedPlatforms = (args.platforms ?? "linux/amd64,linux/arm64")
    .split(",").map((value) => value.trim()).filter(Boolean);

  const result = await resolveRelease({
    repository,
    reference: tag,
    expectedRevision: revision,
    expectedPlatforms,
    registry: "https://registry-1.docker.io",
    tokenUrl: `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
  });

  const outputs = {
    status: result.status,
    existing: result.status === "existing" ? "true" : "false",
  };
  if (result.status === "existing") {
    outputs.index_digest = result.indexDigest;
    outputs.platforms_json = JSON.stringify(result.platforms);
    for (const item of result.platforms) outputs[`${item.platform.replace("/", "_")}_digest`] = item.manifestDigest;
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  } else {
    console.log(JSON.stringify({ ...result, ...outputs }, null, 2));
  }

  if (result.status === "absent") {
    console.log(`Release ${repository}:${tag} is absent; a new multi-platform build is required.`);
  } else if (result.status === "existing") {
    console.log(`Release ${repository}:${tag} is a complete unchanged multi-platform release (${result.indexDigest}).`);
  } else if (result.status === "invalid") {
    console.error(result.failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.error(result.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
