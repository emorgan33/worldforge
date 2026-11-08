import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createArtifactMetadata,
  sha256File,
  validateArtifactMetadata,
  verifyArtifact,
} from "../scripts/release-artifact.mjs";

const revision = "a".repeat(40);
const imageId = `sha256:${"1".repeat(64)}`;
const sourceDigest = `sha256:${"2".repeat(64)}`;
const cli = new URL("../scripts/release-artifact.mjs", import.meta.url);

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-artifact-"));
  return {
    directory,
    archive: join(directory, "image.tar.gz"),
    metadata: join(directory, "image.json"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

async function metadataFor(archive: string, overrides: Record<string, unknown> = {}) {
  return createArtifactMetadata({
    platform: "linux/amd64",
    architecture: "amd64",
    revision,
    imageId,
    archiveSha256: await sha256File(archive),
    mode: "built",
    sourceDigest,
    ...overrides,
  });
}

test("writes and verifies matching archive metadata", async () => {
  const files = workspace();
  try {
    writeFileSync(files.archive, "image archive bytes");
    const metadata = await metadataFor(files.archive);
    writeFileSync(files.metadata, JSON.stringify(metadata));
    const verified = await verifyArtifact({
      metadataPath: files.metadata,
      archivePath: files.archive,
      platform: "linux/amd64",
      architecture: "amd64",
      revision,
    });
    assert.deepEqual(verified, metadata);
  } finally {
    files.cleanup();
  }
});

test("detects an altered archive", async () => {
  const files = workspace();
  try {
    writeFileSync(files.archive, "original");
    const metadata = await metadataFor(files.archive);
    writeFileSync(files.metadata, JSON.stringify(metadata));
    writeFileSync(files.archive, "tampered");
    await assert.rejects(
      verifyArtifact({ metadataPath: files.metadata, archivePath: files.archive, platform: "linux/amd64", architecture: "amd64", revision }),
      /archive checksum/,
    );
  } finally {
    files.cleanup();
  }
});

test("detects wrong platform, architecture and revision", async () => {
  const files = workspace();
  try {
    writeFileSync(files.archive, "image archive bytes");
    const metadata = await metadataFor(files.archive);
    writeFileSync(files.metadata, JSON.stringify(metadata));
    for (const [override, pattern] of [
      [{ platform: "linux/arm64", architecture: "arm64" }, /platform .* does not match/],
      [{ architecture: "arm64" }, /architecture .* does not match/],
      [{ revision: "b".repeat(40) }, /revision .* does not match/],
    ] as const) {
      const base = {
        metadataPath: files.metadata,
        archivePath: files.archive,
        platform: "linux/amd64",
        architecture: "amd64",
        revision,
      };
      await assert.rejects(verifyArtifact(Object.assign({}, base, override)), pattern);
    }
  } finally {
    files.cleanup();
  }
});

test("rejects malformed metadata", () => {
  for (const value of [
    null,
    {},
    { platform: "linux/386", architecture: "386", revision, imageId, archiveSha256: imageId, mode: "built", sourceDigest },
    { platform: "linux/arm64", architecture: "amd64", revision, imageId, archiveSha256: imageId, mode: "built", sourceDigest },
    { platform: "linux/amd64", architecture: "amd64", revision: "short", imageId, archiveSha256: imageId, mode: "built", sourceDigest },
    { platform: "linux/amd64", architecture: "amd64", revision, imageId: "bad", archiveSha256: imageId, mode: "built", sourceDigest },
    { platform: "linux/amd64", architecture: "amd64", revision, imageId, archiveSha256: "bad", mode: "built", sourceDigest },
    { platform: "linux/amd64", architecture: "amd64", revision, imageId, archiveSha256: imageId, mode: "uploaded", sourceDigest },
    { platform: "linux/amd64", architecture: "amd64", revision, imageId, archiveSha256: imageId, mode: "built", sourceDigest: "bad" },
  ]) {
    assert.ok(validateArtifactMetadata(value).length > 0, `expected ${JSON.stringify(value)} to fail`);
  }
});

test("createArtifactMetadata rejects invalid fields", async () => {
  assert.throws(
    () => createArtifactMetadata({
      platform: "linux/arm64",
      architecture: "amd64",
      revision,
      imageId,
      archiveSha256: imageId,
      mode: "built",
      sourceDigest,
    }),
    /architecture must match platform/,
  );
});

test("CLI writes and verifies an artifact", async () => {
  const files = workspace();
  try {
    writeFileSync(files.archive, "cli archive bytes");
    const write = spawnSync(process.execPath, [
      cli.pathname, "write",
      "--output", files.metadata,
      "--archive", files.archive,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
      "--image-id", imageId,
      "--mode", "reused",
      "--source-digest", sourceDigest,
    ], { encoding: "utf8" });
    assert.equal(write.status, 0, write.stderr);
    const metadata = JSON.parse(readFileSync(files.metadata, "utf8"));
    assert.equal(metadata.archiveSha256, `sha256:${createHash("sha256").update("cli archive bytes").digest("hex")}`);

    const verify = spawnSync(process.execPath, [
      cli.pathname, "verify",
      "--metadata", files.metadata,
      "--archive", files.archive,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
    ], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);

    writeFileSync(files.archive, "changed");
    const mismatch = spawnSync(process.execPath, [
      cli.pathname, "verify",
      "--metadata", files.metadata,
      "--archive", files.archive,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
    ], { encoding: "utf8" });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /archive checksum/);
  } finally {
    files.cleanup();
  }
});
