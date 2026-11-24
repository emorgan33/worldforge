import assert from "node:assert/strict";
import test from "node:test";
import packageMetadata from "../package.json";
import { formatBuildLabel, parseBuildInfo, shortRevision, UNKNOWN_REVISION } from "../src/lib/build-info";

test("a recorded revision and version describe the exact build", () => {
  const build = parseBuildInfo({ version: "0.4.10", revision: "4914EF1B2C3D4E5F60718293A4B5C6D7E8F90123", dirty: "0" });
  assert.deepEqual(build, {
    version: "0.4.10",
    revision: "4914ef1b2c3d4e5f60718293a4b5c6d7e8f90123",
    dirty: false,
  });
  assert.equal(formatBuildLabel(build), "v0.4.10 · 4914ef1");
  assert.equal(shortRevision(build.revision), "4914ef1");
});

test("the package version is used when no build version is supplied", () => {
  assert.equal(parseBuildInfo({ revision: "4914ef1" }).version, packageMetadata.version);
});

test("missing or malformed revisions are reported as unknown, never guessed", () => {
  for (const revision of [undefined, null, "", "   ", "not-a-revision", "12345", "main"]) {
    const build = parseBuildInfo({ version: "0.4.10", revision });
    assert.equal(build.revision, UNKNOWN_REVISION);
    assert.equal(formatBuildLabel(build), "v0.4.10 · revision unknown");
    assert.equal(shortRevision(build.revision), UNKNOWN_REVISION);
  }
});

test("a build from modified source is labelled", () => {
  assert.equal(formatBuildLabel(parseBuildInfo({ version: "0.4.10", revision: "4914ef1", dirty: true })), "v0.4.10 · 4914ef1 · modified source");
  assert.equal(formatBuildLabel(parseBuildInfo({ version: "0.4.10", revision: "4914ef1", dirty: "1" })), "v0.4.10 · 4914ef1 · modified source");
  assert.equal(formatBuildLabel(parseBuildInfo({ version: "0.4.10", revision: "4914ef1", dirty: "true" })), "v0.4.10 · 4914ef1 · modified source");
  assert.equal(formatBuildLabel(parseBuildInfo({ version: "0.4.10", revision: "4914ef1", dirty: "0" })), "v0.4.10 · 4914ef1");
});
