import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createReleaseIndexMetadata,
  planIndexPublication,
  validateReleaseIndexMetadata,
  verifyIndexPublication,
} from "../scripts/release-index.mjs";

const revision = "a".repeat(40);
const indexDigest = `sha256:${"1".repeat(64)}`;
const amd64Digest = `sha256:${"2".repeat(64)}`;
const arm64Digest = `sha256:${"3".repeat(64)}`;
const version = "0.4.4";
const shaTag = `sha-${revision}`;
const cli = new URL("../scripts/release-index.mjs", import.meta.url);

function targets(overrides: Array<{ tag: string; existingIndexDigest: string | null }> = []) {
  return overrides.length ? overrides : [
    { tag: version, existingIndexDigest: null },
    { tag: shaTag, existingIndexDigest: null },
  ];
}

test("plans both tags as creates when absent", () => {
  const result = planIndexPublication({ expectedIndexDigest: indexDigest, targets: targets() });
  assert.equal(result.valid, true);
  assert.deepEqual(result.actions, [
    { tag: version, action: "create" },
    { tag: shaTag, action: "create" },
  ]);
});

test("plans only missing tags and noops matching tags", () => {
  const result = planIndexPublication({
    expectedIndexDigest: indexDigest,
    targets: targets([
      { tag: version, existingIndexDigest: indexDigest },
      { tag: shaTag, existingIndexDigest: null },
    ]),
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.actions, [
    { tag: version, action: "noop" },
    { tag: shaTag, action: "create" },
  ]);
});

test("rejects conflicting tags without planning writes", () => {
  const result = planIndexPublication({
    expectedIndexDigest: indexDigest,
    targets: targets([
      { tag: version, existingIndexDigest: `sha256:${"4".repeat(64)}` },
      { tag: shaTag, existingIndexDigest: null },
    ]),
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.actions, []);
  assert.match(result.failures.join("\n"), /different index/);
});

test("requires exactly one version tag and one sha tag", () => {
  for (const value of [
    [],
    [{ tag: version, existingIndexDigest: null }],
    [
      { tag: version, existingIndexDigest: null },
      { tag: "0.4.5", existingIndexDigest: null },
    ],
    [
      { tag: version, existingIndexDigest: null },
      { tag: shaTag, existingIndexDigest: null },
      { tag: `sha-${"b".repeat(40)}`, existingIndexDigest: null },
    ],
    [
      { tag: version, existingIndexDigest: null },
      { tag: shaTag, existingIndexDigest: null },
      { tag: version, existingIndexDigest: null },
    ],
  ]) {
    const result = planIndexPublication({ expectedIndexDigest: indexDigest, targets: value });
    assert.equal(result.valid, false);
    assert.deepEqual(result.actions, []);
  }
});

test("rejects invalid expected digests and target values", () => {
  for (const value of [
    { expectedIndexDigest: "bad", targets: targets() },
    { expectedIndexDigest: indexDigest, targets: [{ tag: "latest", existingIndexDigest: null }, { tag: shaTag, existingIndexDigest: null }] },
    { expectedIndexDigest: indexDigest, targets: [{ tag: version, existingIndexDigest: "bad" }, { tag: shaTag, existingIndexDigest: null }] },
  ]) {
    assert.equal(planIndexPublication(value).valid, false);
  }
});

test("verifies both tags resolve to the expected index", () => {
  const result = verifyIndexPublication({
    expectedIndexDigest: indexDigest,
    targets: [
      { tag: version, existingIndexDigest: indexDigest },
      { tag: shaTag, existingIndexDigest: indexDigest },
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);

  for (const value of [
    [{ tag: version, existingIndexDigest: indexDigest }, { tag: shaTag, existingIndexDigest: null }],
    [{ tag: version, existingIndexDigest: indexDigest }, { tag: shaTag, existingIndexDigest: `sha256:${"4".repeat(64)}` }],
  ]) {
    assert.equal(verifyIndexPublication({ expectedIndexDigest: indexDigest, targets: value }).valid, false);
  }
});

test("creates valid release index metadata", () => {
  const metadata = createReleaseIndexMetadata({
    version,
    revision,
    indexDigest,
    amd64Digest,
    arm64Digest,
    mode: "created",
    stagingIndexTag: "staging-index-1234-2",
    targets: [
      { tag: version, existingIndexDigest: indexDigest },
      { tag: shaTag, existingIndexDigest: indexDigest },
    ],
  });
  assert.deepEqual(validateReleaseIndexMetadata(metadata), []);
  const existing = createReleaseIndexMetadata({
    version,
    revision,
    indexDigest,
    amd64Digest,
    arm64Digest,
    mode: "existing",
    stagingIndexTag: "",
    targets: [
      { tag: version, existingIndexDigest: indexDigest },
      { tag: shaTag, existingIndexDigest: indexDigest },
    ],
  });
  assert.deepEqual(validateReleaseIndexMetadata(existing), []);
});

test("rejects malformed release index metadata", () => {
  for (const metadata of [
    null,
    {},
    { version: "latest", revision, indexDigest, amd64Digest, arm64Digest, mode: "created", stagingIndexTag: "staging-index-1-1", targets: targetsWithDigest(indexDigest) },
    { version, revision: "short", indexDigest, amd64Digest, arm64Digest, mode: "created", stagingIndexTag: "staging-index-1-1", targets: targetsWithDigest(indexDigest) },
    { version, revision, indexDigest: "bad", amd64Digest, arm64Digest, mode: "created", stagingIndexTag: "staging-index-1-1", targets: targetsWithDigest(indexDigest) },
    { version, revision, indexDigest, amd64Digest: "bad", arm64Digest, mode: "created", stagingIndexTag: "staging-index-1-1", targets: targetsWithDigest(indexDigest) },
    { version, revision, indexDigest, amd64Digest, arm64Digest, mode: "uploaded", stagingIndexTag: "staging-index-1-1", targets: targetsWithDigest(indexDigest) },
    { version, revision, indexDigest, amd64Digest, arm64Digest, mode: "created", stagingIndexTag: "", targets: targetsWithDigest(indexDigest) },
    { version, revision, indexDigest, amd64Digest, arm64Digest, mode: "existing", stagingIndexTag: "staging-index-1-1", targets: targetsWithDigest(indexDigest) },
    { version, revision, indexDigest, amd64Digest, arm64Digest, mode: "existing", stagingIndexTag: "", targets: targetsWithDigest(arm64Digest) },
  ]) {
    assert.ok(validateReleaseIndexMetadata(metadata).length > 0, `expected ${JSON.stringify(metadata)} to fail`);
  }
});

function targetsWithDigest(digest: string) {
  return [
    { tag: version, existingIndexDigest: digest },
    { tag: shaTag, existingIndexDigest: digest },
  ];
}

test("CLI plans, writes and verifies release index metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-release-index-"));
  try {
    const planPath = join(directory, "plan.json");
    const plan = spawnSync(process.execPath, [
      cli.pathname, "plan",
      "--expected", indexDigest,
      "--target", `${version}=absent`,
      "--target", `${shaTag}=absent`,
      "--output", planPath,
    ], { encoding: "utf8" });
    assert.equal(plan.status, 0, plan.stderr);
    assert.deepEqual(JSON.parse(readFileSync(planPath, "utf8")).actions.map((item: { action: string }) => item.action), ["create", "create"]);

    const metadataPath = join(directory, "release-index.json");
    const write = spawnSync(process.execPath, [
      cli.pathname, "write",
      "--output", metadataPath,
      "--version", version,
      "--revision", revision,
      "--index-digest", indexDigest,
      "--amd64-digest", amd64Digest,
      "--arm64-digest", arm64Digest,
      "--mode", "created",
      "--staging-index-tag", "staging-index-1234-2",
      "--target", `${version}=${indexDigest}`,
      "--target", `${shaTag}=${indexDigest}`,
    ], { encoding: "utf8" });
    assert.equal(write.status, 0, write.stderr);

    const verify = spawnSync(process.execPath, [
      cli.pathname, "verify",
      "--expected", indexDigest,
      "--target", `${version}=${indexDigest}`,
      "--target", `${shaTag}=${indexDigest}`,
    ], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);

    const conflict = spawnSync(process.execPath, [
      cli.pathname, "plan",
      "--expected", indexDigest,
      "--target", `${version}=${`sha256:${"4".repeat(64)}`}`,
      "--target", `${shaTag}=absent`,
      "--output", join(directory, "conflict.json"),
    ], { encoding: "utf8" });
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /different index/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("metadata targets can be derived from a digest list", () => {
  assert.equal(validateReleaseIndexMetadata({
    version,
    revision,
    indexDigest,
    amd64Digest,
    arm64Digest,
    mode: "existing",
    stagingIndexTag: "",
    targets: targetsWithDigest(indexDigest),
  }).length, 0);
});
