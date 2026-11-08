import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  mergeImageNotes,
  renderImageNotes,
  shouldAdvanceLatest,
} from "../scripts/release-finalize.mjs";

const image = "emorgan33/worldforge";
const version = "0.4.4";
const indexDigest = `sha256:${"1".repeat(64)}`;
const amd64Digest = `sha256:${"2".repeat(64)}`;
const arm64Digest = `sha256:${"3".repeat(64)}`;
const cli = new URL("../scripts/release-finalize.mjs", import.meta.url);

function block(overrides: Record<string, unknown> = {}) {
  return renderImageNotes({ image, version, indexDigest, amd64Digest, arm64Digest, ...overrides });
}

test("advances latest only for the current stable release", () => {
  assert.equal(shouldAdvanceLatest({ latestTag: "v0.4.4", releaseTag: "v0.4.4", prerelease: false }), true);
  assert.equal(shouldAdvanceLatest({ latestTag: "v0.4.3", releaseTag: "v0.4.4", prerelease: false }), false);
  assert.equal(shouldAdvanceLatest({ latestTag: "v0.4.4", releaseTag: "v0.4.4", prerelease: true }), false);
  assert.equal(shouldAdvanceLatest({ latestTag: "v0.4.4", releaseTag: "v0.4.5", prerelease: false }), false);
  assert.equal(shouldAdvanceLatest({ latestTag: "v0.4.4", releaseTag: "v0.4.5-rc.1", prerelease: false }), false);
  assert.equal(shouldAdvanceLatest({ latestTag: "", releaseTag: "v0.4.4", prerelease: false }), false);
  assert.throws(() => shouldAdvanceLatest({ latestTag: "v0.4.4", releaseTag: "v0.4.4", prerelease: "false" }), /prerelease/);
});

test("renders stable and prerelease image sections", () => {
  const text = block();
  assert.match(text, /<!-- worldforge-image-release -->/);
  assert.match(text, /<!-- \/worldforge-image-release -->/);
  assert.match(text, /linux\/amd64, linux\/arm64/);
  assert.match(text, new RegExp(`\`${image}:${version}\``));
  for (const digest of [indexDigest, amd64Digest, arm64Digest]) assert.match(text, new RegExp(digest));
  assert.doesNotMatch(text, /latest/);

  const prerelease = block({ version: "0.4.5-rc.1" });
  assert.match(prerelease, /0\.4\.5-rc\.1/);
});

test("merges notes without duplicating the image section", () => {
  const notes = block();
  const merged = mergeImageNotes("Release heading\n\nExisting notes.", notes);
  assert.match(merged, /Release heading/);
  assert.match(merged, /Existing notes\./);
  assert.equal(merged.split("<!-- worldforge-image-release -->").length - 1, 1);
  assert.equal(mergeImageNotes(merged, notes), merged);

  const replacement = block({ indexDigest: `sha256:${"4".repeat(64)}` });
  const replaced = mergeImageNotes(merged, replacement);
  assert.match(replaced, new RegExp(`sha256:${"4".repeat(64)}`));
  assert.doesNotMatch(replaced, new RegExp(indexDigest));
  assert.equal(replaced.split("<!-- worldforge-image-release -->").length - 1, 1);
});

test("rejects malformed or duplicate image markers", () => {
  for (const body of [
    "<!-- worldforge-image-release -->\nno end",
    "<!-- /worldforge-image-release -->",
    "<!-- worldforge-image-release -->\n<!-- /worldforge-image-release -->\n<!-- worldforge-image-release -->\n<!-- /worldforge-image-release -->",
  ]) {
    assert.throws(() => mergeImageNotes(body, block()), /malformed|duplicate/);
  }
});

test("rejects invalid inputs", () => {
  for (const value of [
    { image: "https://example.invalid", version, indexDigest, amd64Digest, arm64Digest },
    { image, version: "v0.4.4", indexDigest, amd64Digest, arm64Digest },
    { image, version, indexDigest: "bad", amd64Digest, arm64Digest },
    { image, version, indexDigest, amd64Digest: "bad", arm64Digest },
    { image, version, indexDigest, amd64Digest, arm64Digest: "bad" },
  ]) {
    assert.throws(() => renderImageNotes(value), /must be/);
  }
});

test("CLI decides latest and writes merged notes", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-finalize-"));
  try {
    const latest = spawnSync(process.execPath, [
      cli.pathname, "latest",
      "--latest-tag", "v0.4.4",
      "--release-tag", "v0.4.4",
      "--prerelease", "false",
    ], { encoding: "utf8" });
    assert.equal(latest.status, 0, latest.stderr);
    assert.equal(latest.stdout.trim(), "true");

    const old = spawnSync(process.execPath, [
      cli.pathname, "latest",
      "--latest-tag", "v0.4.3",
      "--release-tag", "v0.4.4",
      "--prerelease", "false",
    ], { encoding: "utf8" });
    assert.equal(old.stdout.trim(), "false");

    const empty = spawnSync(process.execPath, [
      cli.pathname, "latest",
      "--latest-tag", "",
      "--release-tag", "v0.4.4",
      "--prerelease", "false",
    ], { encoding: "utf8" });
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(empty.stdout.trim(), "false");

    const bodyPath = join(directory, "body.md");
    const outputPath = join(directory, "notes.md");
    writeFileSync(bodyPath, "Existing release notes.");
    const notes = spawnSync(process.execPath, [
      cli.pathname, "notes",
      "--body", bodyPath,
      "--output", outputPath,
      "--image", image,
      "--version", version,
      "--index-digest", indexDigest,
      "--amd64-digest", amd64Digest,
      "--arm64-digest", arm64Digest,
    ], { encoding: "utf8" });
    assert.equal(notes.status, 0, notes.stderr);
    const written = readFileSync(outputPath, "utf8");
    assert.match(written, /Existing release notes\./);
    assert.match(written, /worldforge-image-release/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
