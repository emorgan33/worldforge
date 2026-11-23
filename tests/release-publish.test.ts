import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPublicationMetadata,
  selectPlatformManifestDigest,
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

    const child = spawnSync(process.execPath, [
      cli.pathname, "child",
      "--metadata", metadataPath,
      "--platform", "linux/amd64",
      "--architecture", "amd64",
      "--revision", revision,
    ], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), childDigest);

    const wrongChild = spawnSync(process.execPath, [
      cli.pathname, "child",
      "--metadata", metadataPath,
      "--platform", "linux/arm64",
      "--architecture", "arm64",
      "--revision", revision,
    ], { encoding: "utf8" });
    assert.equal(wrongChild.status, 1);
    assert.match(wrongChild.stderr, /does not match/);

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

const amd64Manifest = `sha256:${"3".repeat(64)}`;
const arm64Manifest = `sha256:${"4".repeat(64)}`;
const attestation = `sha256:${"5".repeat(64)}`;
const pushedIndex = `sha256:${"6".repeat(64)}`;

function pushedImage(descriptors: unknown[]) {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: descriptors,
  };
}

test("uses the pushed digest when a push publishes one image manifest", () => {
  const manifest = { schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json" };
  assert.equal(
    selectPlatformManifestDigest(manifest, { architecture: "amd64", pushedDigest: amd64Manifest }),
    amd64Manifest,
  );
});

test("selects the platform manifest from an index carrying attestations", () => {
  const manifest = pushedImage([
    { digest: amd64Manifest, platform: { os: "linux", architecture: "amd64" } },
    {
      digest: attestation,
      platform: { os: "unknown", architecture: "unknown" },
      annotations: { "vnd.docker.reference.type": "attestation-manifest" },
    },
  ]);
  assert.equal(
    selectPlatformManifestDigest(manifest, { architecture: "amd64", pushedDigest: pushedIndex }),
    amd64Manifest,
  );
  assert.throws(
    () => selectPlatformManifestDigest(manifest, { architecture: "arm64", pushedDigest: pushedIndex }),
    /unexpected linux\/amd64 content/,
  );
});

test("supports Docker manifest lists and selects the pushed platform", () => {
  const manifestList = (digest: string, architecture: string) => ({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.list.v2+json",
    manifests: [{ digest, platform: { os: "linux", architecture, ...(architecture === "arm64" ? { variant: "v8" } : {}) } }],
  });
  assert.equal(
    selectPlatformManifestDigest(manifestList(amd64Manifest, "amd64"), { architecture: "amd64", pushedDigest: pushedIndex }),
    amd64Manifest,
  );
  assert.equal(
    selectPlatformManifestDigest(manifestList(arm64Manifest, "arm64"), { architecture: "arm64", pushedDigest: pushedIndex }),
    arm64Manifest,
  );
  assert.throws(
    () => selectPlatformManifestDigest({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.list.v2+json",
      manifests: [
        { digest: amd64Manifest, platform: { os: "linux", architecture: "amd64" } },
        { digest: arm64Manifest, platform: { os: "linux", architecture: "arm64", variant: "v8" } },
      ],
    }, { architecture: "amd64", pushedDigest: pushedIndex }),
    /unexpected linux\/arm64 content/,
  );
});

test("rejects malformed indexes instead of falling back to the pushed digest", () => {
  const indexType = "application/vnd.oci.image.index.v1+json";
  for (const [manifest, expected] of [
    [{ schemaVersion: 2, mediaType: indexType }, /must include a manifests array/],
    [{ schemaVersion: 2, mediaType: indexType, manifests: null }, /must include a manifests array/],
    [{ schemaVersion: 2, mediaType: indexType, manifests: {} }, /must include a manifests array/],
    [{ schemaVersion: 2, mediaType: "application/vnd.example.unknown" }, /unsupported media type/],
    [{ schemaVersion: 2 }, /unsupported media type/],
    [{ schemaVersion: 1, mediaType: "application/vnd.oci.image.manifest.v1+json" }, /schemaVersion must be 2/],
  ] as [unknown, RegExp][]) {
    assert.throws(() => selectPlatformManifestDigest(manifest, { architecture: "amd64", pushedDigest: pushedIndex }), expected);
  }
});

test("rejects ambiguous or unexpected pushed manifests", () => {
  const cases: [unknown, string][] = [
    [pushedImage([]), /exactly one linux\/amd64 image; found 0/],
    [pushedImage([
      { digest: amd64Manifest, platform: { os: "linux", architecture: "amd64" } },
      { digest: arm64Manifest, platform: { os: "linux", architecture: "amd64" } },
    ]), /exactly one linux\/amd64 image; found 2/],
    [pushedImage([{ digest: amd64Manifest, platform: { os: "linux", architecture: "386" } }]), /unexpected linux\/386 content/],
    [pushedImage([{ digest: amd64Manifest }]), /unexpected unknown\/unknown content/],
    [pushedImage([{ digest: attestation, platform: { os: "linux", architecture: "amd64" }, annotations: { "vnd.docker.reference.type": "attestation-manifest" } }]), /must use the unknown\/unknown platform/],
    [pushedImage([{ digest: "bad", platform: { os: "linux", architecture: "amd64" } }]), /invalid digest/],
    [pushedImage([null]), /descriptor 0 is malformed/],
    [null, /must be a JSON object/],
    [[], /must be a JSON object/],
  ];
  for (const [manifest, expected] of cases) {
    assert.throws(() => selectPlatformManifestDigest(manifest, { architecture: "amd64", pushedDigest: pushedIndex }), expected);
  }
  assert.throws(
    () => selectPlatformManifestDigest({ schemaVersion: 2 }, { architecture: "386", pushedDigest: amd64Manifest }),
    /architecture must be amd64 or arm64/,
  );
  assert.throws(
    () => selectPlatformManifestDigest({ schemaVersion: 2 }, { architecture: "amd64", pushedDigest: "bad" }),
    /pushedDigest must be a sha256 digest/,
  );
});

test("CLI selects the platform manifest from a pushed reference", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldforge-publication-"));
  try {
    const manifestPath = join(directory, "pushed.json");
    writeFileSync(manifestPath, JSON.stringify(pushedImage([
      { digest: amd64Manifest, platform: { os: "linux", architecture: "amd64" } },
      {
        digest: attestation,
        platform: { os: "unknown", architecture: "unknown" },
        annotations: { "vnd.docker.reference.type": "attestation-manifest" },
      },
    ])));
    const selected = spawnSync(process.execPath, [
      cli.pathname, "select-child",
      "--manifest", manifestPath,
      "--architecture", "amd64",
      "--pushed-digest", pushedIndex,
    ], { encoding: "utf8" });
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(selected.stdout.trim(), amd64Manifest);

    const missing = spawnSync(process.execPath, [
      cli.pathname, "select-child",
      "--manifest", join(directory, "missing.json"),
      "--architecture", "amd64",
      "--pushed-digest", pushedIndex,
    ], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /could not read the pushed manifest/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
