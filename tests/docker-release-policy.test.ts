import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseManifest } from "../scripts/docker-release-policy.mjs";

const revision = "a".repeat(40);
const media = {
  oci: {
    index: "application/vnd.oci.image.index.v1+json",
    manifest: "application/vnd.oci.image.manifest.v1+json",
    config: "application/vnd.oci.image.config.v1+json",
  },
  docker: {
    index: "application/vnd.docker.distribution.manifest.list.v2+json",
    manifest: "application/vnd.docker.distribution.manifest.v2+json",
    config: "application/vnd.docker.container.image.v1+json",
  },
};

type Descriptor = {
  mediaType: string;
  digest: string;
  size: number;
  platform: { os: string; architecture: string; variant?: string };
  annotations?: Record<string, string>;
};
type Layer = { mediaType: string; digest: string; size: number };
type ChildManifest = {
  schemaVersion: number;
  mediaType: string;
  config: { mediaType: string; digest: string; size: number };
  layers: Layer[];
};
type ChildConfig = {
  architecture: string;
  os: string;
  variant?: string;
  rootfs: { type: string; diff_ids: string[] };
  config: { Labels: Record<string, string> };
};
type Release = {
  index: { schemaVersion: number; mediaType: string; manifests: Descriptor[] };
  manifests: Record<string, ChildManifest>;
  configs: Record<string, ChildConfig>;
  expectedRevision: string;
  indexDigest: string;
};

function digest(value: number) {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function makeRelease({ amd64 = true, arm64 = true, format = "oci" as "oci" | "docker" } = {}): Release {
  const types = media[format];
  const index = { schemaVersion: 2, mediaType: types.index, manifests: [] as Descriptor[] };
  const manifests: Record<string, ChildManifest> = {};
  const configs: Record<string, ChildConfig> = {};
  let next = 1;
  const add = (architecture: "amd64" | "arm64", variant?: string) => {
    const manifestDigest = digest(next++);
    const configDigest = digest(next++);
    const layerDigest = digest(next++);
    configs[configDigest] = {
      architecture,
      os: "linux",
      ...(variant ? { variant } : {}),
      rootfs: { type: "layers", diff_ids: [layerDigest] },
      config: { Labels: { "org.opencontainers.image.revision": revision } },
    };
    manifests[manifestDigest] = {
      schemaVersion: 2,
      mediaType: types.manifest,
      config: { mediaType: types.config, digest: configDigest, size: 500 },
      layers: [{
        mediaType: format === "oci"
          ? "application/vnd.oci.image.layer.v1.tar+gzip"
          : "application/vnd.docker.image.rootfs.diff.tar.gzip",
        digest: layerDigest,
        size: 200,
      }],
    };
    index.manifests.push({
      mediaType: types.manifest,
      digest: manifestDigest,
      size: 1000,
      platform: { os: "linux", architecture, ...(variant ? { variant } : {}) },
    });
  };
  if (amd64) add("amd64");
  if (arm64) add("arm64", "v8");
  index.manifests.push({
    mediaType: types.manifest,
    digest: digest(next++),
    size: 500,
    platform: { os: "unknown", architecture: "unknown" },
    annotations: { "vnd.docker.reference.type": "attestation-manifest" },
  });
  return { index, manifests, configs, expectedRevision: revision, indexDigest: digest(next++) };
}

function configFor(input: Release, architecture: "amd64" | "arm64") {
  const entry = Object.entries(input.configs).find(([, config]) => config.architecture === architecture);
  assert.ok(entry, `missing ${architecture} config`);
  return entry[1];
}

function manifestFor(input: Release, architecture: "amd64" | "arm64") {
  const descriptor = input.index.manifests.find((item) => item.platform.architecture === architecture);
  assert.ok(descriptor);
  return input.manifests[descriptor.digest];
}

function invalid(input: unknown, pattern: RegExp) {
  const result = evaluateReleaseManifest(input);
  assert.equal(result.valid, false);
  assert.match(result.failures.join("\n"), pattern);
  return result;
}

test("accepts a complete OCI index with amd64, arm64 and attestation metadata", () => {
  const input = makeRelease();
  const result = evaluateReleaseManifest(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.indexDigest, input.indexDigest);
  assert.deepEqual(result.platforms.map((item) => item.platform), ["linux/amd64", "linux/arm64"]);
  assert.match(result.platforms[0].manifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.platforms[1].configDigest, /^sha256:[0-9a-f]{64}$/);
});

test("accepts Docker manifest-list media types", () => {
  const result = evaluateReleaseManifest(makeRelease({ format: "docker" }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
});

test("accepts an arm64 descriptor without an explicit variant", () => {
  const input = makeRelease();
  const descriptor = input.index.manifests.find((item) => item.platform?.architecture === "arm64")!;
  delete descriptor.platform.variant;
  delete configFor(input, "arm64").variant;
  const result = evaluateReleaseManifest(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
});

test("rejects a legacy single-platform index", () => {
  invalid(makeRelease({ arm64: false }), /linux\/arm64/);
});

test("rejects duplicate manifests for one expected platform", () => {
  const input = makeRelease();
  const descriptor = input.index.manifests.find((item) => item.platform?.architecture === "amd64")!;
  input.index.manifests.push({ ...descriptor, digest: digest(990) });
  invalid(input, /Expected exactly one linux\/amd64/);
});

test("rejects unexpected runnable platforms", () => {
  const input = makeRelease();
  input.index.manifests.push({
    mediaType: media.oci.manifest,
    digest: digest(991),
    size: 1,
    platform: { os: "linux", architecture: "386" },
  });
  invalid(input, /Unsupported runnable platform linux\/386/);
});

test("rejects unrecognized metadata descriptors", () => {
  const input = makeRelease();
  input.index.manifests.push({
    mediaType: media.oci.manifest,
    digest: digest(992),
    size: 1,
    platform: { os: "unknown", architecture: "unknown" },
  });
  invalid(input, /Unrecognized metadata descriptor/);
});

test("rejects attestation metadata with a runnable platform", () => {
  const input = makeRelease();
  const attestation = input.index.manifests.find((item) => item.annotations)!;
  attestation.platform = { os: "linux", architecture: "amd64" };
  invalid(input, /Attestation descriptor .* must use the unknown\/unknown platform/);
});

test("rejects unsupported arm64 variants", () => {
  const input = makeRelease();
  const descriptor = input.index.manifests.find((item) => item.platform?.architecture === "arm64")!;
  descriptor.platform.variant = "v9";
  invalid(input, /Unsupported runnable platform linux\/arm64\/v9/);
});

test("rejects missing child manifests and configs", () => {
  const missingManifest = makeRelease();
  const armManifest = manifestFor(missingManifest, "arm64");
  const armDescriptor = missingManifest.index.manifests.find((item) => item.platform?.architecture === "arm64")!;
  delete missingManifest.manifests[armDescriptor.digest as string];
  invalid(missingManifest, /Missing manifest/);

  const missingConfig = makeRelease();
  delete missingConfig.configs[armManifest.config.digest];
  invalid(missingConfig, /Missing config/);
});

test("rejects a config whose platform differs from its descriptor", () => {
  const input = makeRelease();
  configFor(input, "arm64").architecture = "amd64";
  invalid(input, /does not match linux\/arm64/);
});

test("rejects wrong or missing source revisions on either platform", () => {
  for (const architecture of ["amd64", "arm64"] as const) {
    const input = makeRelease();
    configFor(input, architecture).config.Labels["org.opencontainers.image.revision"] = "b".repeat(40);
    invalid(input, /revision .* does not match expected/);
  }
  const missing = makeRelease();
  delete configFor(missing, "amd64").config.Labels["org.opencontainers.image.revision"];
  invalid(missing, /revision .* does not match expected/);
});

test("rejects malformed index metadata and expected revisions", () => {
  const wrongType = makeRelease();
  wrongType.index.mediaType = "application/vnd.example.manifest";
  invalid(wrongType, /Unsupported index media type/);

  const wrongSchema = makeRelease();
  wrongSchema.index.schemaVersion = 1;
  invalid(wrongSchema, /schemaVersion must be 2/);

  const empty = makeRelease();
  empty.index.manifests = [];
  invalid(empty, /at least one descriptor/);

  const shortRevision = makeRelease();
  shortRevision.expectedRevision = "abc";
  invalid(shortRevision, /full lowercase 40-character commit SHA/);

  const badDigest = makeRelease();
  badDigest.indexDigest = "sha256:short";
  invalid(badDigest, /Index digest must be a sha256 digest/);
});

test("rejects malformed descriptors, child manifests and config media types", () => {
  const malformedDescriptor = makeRelease();
  malformedDescriptor.index.manifests.push(null as never);
  invalid(malformedDescriptor, /Malformed descriptor/);

  const badDigest = makeRelease();
  badDigest.index.manifests[0].digest = "not-a-digest";
  invalid(badDigest, /Invalid descriptor digest/);

  const duplicateDigest = makeRelease();
  duplicateDigest.index.manifests.push({ ...duplicateDigest.index.manifests[0] });
  invalid(duplicateDigest, /Duplicate descriptor digest/);

  const badChildType = makeRelease();
  manifestFor(badChildType, "amd64").mediaType = media.oci.index;
  invalid(badChildType, /unsupported media type/);

  const badChildSchema = makeRelease();
  manifestFor(badChildSchema, "amd64").schemaVersion = 1;
  invalid(badChildSchema, /schemaVersion must be 2/);

  const badConfigDigest = makeRelease();
  manifestFor(badConfigDigest, "amd64").config.digest = "not-a-digest";
  invalid(badConfigDigest, /invalid config digest/);

  const badConfigType = makeRelease();
  manifestFor(badConfigType, "amd64").config.mediaType = "application/vnd.example.config";
  invalid(badConfigType, /unsupported config media type/);
});

test("rejects invalid descriptor media types and sizes", () => {
  const badRunnableType = makeRelease();
  badRunnableType.index.manifests[0].mediaType = "application/vnd.example.manifest";
  invalid(badRunnableType, /Descriptor .* unsupported media type/);

  const missingRunnableType = makeRelease();
  delete (missingRunnableType.index.manifests[0] as { mediaType?: string }).mediaType;
  invalid(missingRunnableType, /Descriptor .* unsupported media type/);

  const badAttestationType = makeRelease();
  badAttestationType.index.manifests.find((item) => item.annotations)!.mediaType = "bad";
  invalid(badAttestationType, /Descriptor .* unsupported media type/);

  const badSize = makeRelease();
  badSize.index.manifests[0].size = 0;
  invalid(badSize, /Descriptor .* invalid size/);
});

test("rejects malformed child layers and config descriptors", () => {
  const missingLayers = makeRelease();
  delete (manifestFor(missingLayers, "amd64") as { layers?: Layer[] }).layers;
  invalid(missingLayers, /layers array/);

  const badLayerDigest = makeRelease();
  manifestFor(badLayerDigest, "amd64").layers[0].digest = "bad";
  invalid(badLayerDigest, /layer 0 has an invalid digest/);

  const badLayerSize = makeRelease();
  manifestFor(badLayerSize, "amd64").layers[0].size = 0;
  invalid(badLayerSize, /layer 0 has an invalid size/);

  const badLayerType = makeRelease();
  manifestFor(badLayerType, "amd64").layers[0].mediaType = "application/vnd.example.layer";
  invalid(badLayerType, /layer 0 has unsupported media type/);

  const missingConfigSize = makeRelease();
  delete (manifestFor(missingConfigSize, "amd64").config as { size?: number }).size;
  invalid(missingConfigSize, /config descriptor has an invalid size/);
});

test("rejects descriptor and child media-type mismatches", () => {
  const input = makeRelease();
  input.index.manifests[0].mediaType = media.docker.manifest;
  invalid(input, /does not match descriptor/);
});

test("requires a valid index digest for success", () => {
  const missing = makeRelease();
  delete (missing as { indexDigest?: string }).indexDigest;
  invalid(missing, /Index digest is required/);
  invalid({ ...makeRelease(), indexDigest: null }, /Index digest is required/);
  invalid({ ...makeRelease(), indexDigest: "sha256:short" }, /Index digest must be a sha256 digest/);
});

test("rejects malformed config rootfs structure", () => {
  const missingRootfs = makeRelease();
  delete (configFor(missingRootfs, "amd64") as { rootfs?: unknown }).rootfs;
  invalid(missingRootfs, /must include rootfs metadata/);

  const wrongType = makeRelease();
  configFor(wrongType, "amd64").rootfs.type = "files";
  invalid(wrongType, /rootfs type .* must be "layers"/);

  const missingDiffIds = makeRelease();
  delete (configFor(missingDiffIds, "amd64").rootfs as { diff_ids?: string[] }).diff_ids;
  invalid(missingDiffIds, /must include a rootfs\.diff_ids array/);

  const badDiffId = makeRelease();
  configFor(badDiffId, "amd64").rootfs.diff_ids[0] = "bad";
  invalid(badDiffId, /diff_ids entry 0 is not a sha256 digest/);

  const countMismatch = makeRelease();
  configFor(countMismatch, "amd64").rootfs.diff_ids.push(digest(900));
  invalid(countMismatch, /diff_ids count 2 does not match layer count 1/);
});

test("rejects invalid expected platform selections", () => {
  invalid({ ...makeRelease(), expectedPlatforms: ["linux/amd64", "linux/amd64"] }, /Duplicate expected platform/);
  invalid({ ...makeRelease(), expectedPlatforms: ["linux/386"] }, /Unsupported expected platform/);
  invalid({ ...makeRelease(), expectedPlatforms: [] }, /Expected platforms are required/);
});

test("rejects missing or malformed inputs", () => {
  invalid(null, /input is required/);
  invalid({ ...makeRelease(), index: null }, /release index is required/);
  invalid({ ...makeRelease(), manifests: null }, /Child manifests must be an object/);
  invalid({ ...makeRelease(), configs: null }, /Child configs must be an object/);
});
