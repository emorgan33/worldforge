import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPublicationMetadata,
  validatePublicationMetadata,
  verifyPublicationMetadata,
} from "../scripts/release-publish.mjs";

const revision = "a".repeat(40);
const childDigest = `sha256:${"1".repeat(64)}`;
const stagingTag = "staging-1234-2-amd64";
const cli = new URL("../scripts/release-publish.mjs", import.meta.url);

function valid(overrides: Record<string, unknown> = {}) {
  return {
    platform: "linux/amd64",
    architecture: "amd64",
    revision,
    childDigest,
    source: "pushed",
    stagingTag,
    ...overrides,
  };
}

test("accepts pushed and existing publication metadata", () => {
  assert.deepEqual(validatePublicationMetadata(valid()), []);
  assert.deepEqual(validatePublicationMetadata(valid({ source: "existing", stagingTag: "" })), []);
});

test("rejects malformed publication metadata", () => {
  for (const value of [
    null,
    {},
    valid({ platform: "linux/386", architecture: "386" }),
    valid({ platform: "linux/arm64", architecture: "amd64" }),
    valid({ revision: "short" }),
    valid({ childDigest: "bad" }),
    valid({ source: "uploaded" }),
    valid({ source: "pushed", stagingTag: "" }),
    valid({ source: "pushed", stagingTag: "latest" }),
    valid({ source: "pushed", stagingTag: "staging-1234-2-arm64" }),
    valid({ source: "pushed", stagingTag: "release-1234-2-amd64" }),
    valid({ source: "existing", stagingTag }),
  ]) {
    assert.ok(validatePublicationMetadata(value).length > 0, `expected ${JSON.stringify(value)} to fail`);
  }
});

test("verifies platform, architecture, revision and child digest", () => {
  const metadata = createPublicationMetadata(valid());
  assert.deepEqual(verifyPublicationMetadata(metadata, {
    platform: "linux/amd64", architecture: "amd64", revision, childDigest,
  }), metadata);
  for (const override of [
    { platform: "linux/arm64", architecture: "arm64" },
    { architecture: "arm64" },
    { revision: "b".repeat(40) },
    { childDigest: `sha256:${"2".repeat(64)}` },
  ]) {
    assert.throws(
      () => verifyPublicationMetadata(metadata, {
        platform: "linux/amd64", architecture: "amd64", revision, childDigest, ...override,
      }),
      /does not match/,
    );
  }
});

test("CLI writes and verifies publication metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-publication-"));
  try {
    const metadataPath = join(directory, "published.json");
    const write = spawnSync(process.execPath, [
      cli.pathname, "write",
      "--output", metadataPath,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
      "--child-digest", childDigest,
      "--source", "pushed",
      "--staging-tag", stagingTag,
    ], { encoding: "utf8" });
    assert.equal(write.status, 0, write.stderr);

    const verify = spawnSync(process.execPath, [
      cli.pathname, "verify",
      "--metadata", metadataPath,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
      "--child-digest", childDigest,
    ], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);

    const mismatch = spawnSync(process.execPath, [
      cli.pathname, "verify",
      "--metadata", metadataPath,
      "--platform", "linux/arm64",
      "--architecture", "arm64",
      "--revision", revision,
    ], { encoding: "utf8" });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /does not match/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI rejects missing metadata and invalid writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-publication-"));
  try {
    const missing = spawnSync(process.execPath, [
      cli.pathname, "verify",
      "--metadata", join(directory, "missing.json"),
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
    ], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /could not read metadata/);

    const invalid = join(directory, "invalid.json");
    const write = spawnSync(process.execPath, [
      cli.pathname, "write",
      "--output", invalid,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
      "--child-digest", "bad",
      "--source", "pushed",
      "--staging-tag", stagingTag,
    ], { encoding: "utf8" });
    assert.equal(write.status, 1);
    assert.match(write.stderr, /childDigest/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
