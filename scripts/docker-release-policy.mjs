/**
 * Pure validation for a published multi-platform release. The caller supplies
 * the registry index, each referenced child manifest, and each child config
 * blob. This module never fetches or mutates registry state; it decides whether
 * the resolved reference is a complete, unambiguous release for the expected
 * platforms and source revision. Any uncertainty is a failure.
 */
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const DOCKER_INDEX = "application/vnd.docker.distribution.manifest.list.v2+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json";
const OCI_CONFIG = "application/vnd.oci.image.config.v1+json";
const DOCKER_CONFIG = "application/vnd.docker.container.image.v1+json";
const ATTESTATION_TYPE = "vnd.docker.reference.type";
const ATTESTATION_VALUE = "attestation-manifest";
const REVISION_LABEL = "org.opencontainers.image.revision";

const INDEX_TYPES = new Set([OCI_INDEX, DOCKER_INDEX]);
const MANIFEST_TYPES = new Set([OCI_MANIFEST, DOCKER_MANIFEST]);
const CONFIG_TYPES = new Set([OCI_CONFIG, DOCKER_CONFIG]);
const LAYER_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.oci.image.layer.v1.tar+gzip",
  "application/vnd.oci.image.layer.v1.tar+zstd",
  "application/vnd.docker.image.rootfs.diff.tar",
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;

function normalizePlatform(platform) {
  if (!platform || typeof platform !== "object" || platform.os !== "linux") return null;
  if (platform.architecture !== "amd64" && platform.architecture !== "arm64") return null;
  const variant = platform.variant;
  if (variant != null && variant !== "" && !(platform.architecture === "arm64" && variant === "v8")) return null;
  return `linux/${platform.architecture}`;
}

function normalizePlatformString(value) {
  if (typeof value !== "string") return null;
  const [os, architecture, variant, ...rest] = value.split("/");
  if (rest.length) return null;
  return normalizePlatform({ os, architecture, variant });
}

function formatPlatform(platform) {
  if (!platform || typeof platform !== "object") return "unknown";
  return [platform.os, platform.architecture, platform.variant].filter(Boolean).join("/") || "unknown";
}

function isAttestation(descriptor) {
  return descriptor?.annotations?.[ATTESTATION_TYPE] === ATTESTATION_VALUE;
}

export function evaluateReleaseManifest(input) {
  const failures = [];
  const platforms = [];

  if (!input || typeof input !== "object") {
    return { valid: false, failures: ["Release manifest input is required."], indexDigest: null, platforms };
  }
  const {
    index, manifests, configs, expectedRevision, indexDigest,
    expectedPlatforms = ["linux/amd64", "linux/arm64"],
  } = input;

  if (typeof expectedRevision !== "string" || !REVISION.test(expectedRevision)) {
    failures.push("Expected revision must be a full lowercase 40-character commit SHA.");
  }
  if (indexDigest == null) failures.push("Index digest is required.");
  else if (typeof indexDigest !== "string" || !DIGEST.test(indexDigest)) failures.push("Index digest must be a sha256 digest.");

  const expected = new Set();
  if (!Array.isArray(expectedPlatforms) || expectedPlatforms.length === 0) {
    failures.push("Expected platforms are required.");
  } else {
    for (const value of expectedPlatforms) {
      const platform = normalizePlatformString(value);
      if (!platform) failures.push(`Unsupported expected platform ${JSON.stringify(value)}.`);
      else if (expected.has(platform)) failures.push(`Duplicate expected platform ${platform}.`);
      else expected.add(platform);
    }
  }

  if (!index || typeof index !== "object") {
    failures.push("A release index is required.");
    return { valid: false, failures, indexDigest: indexDigest ?? null, platforms };
  }
  if (index.schemaVersion !== 2) failures.push("Index schemaVersion must be 2.");
  if (!INDEX_TYPES.has(index.mediaType)) failures.push(`Unsupported index media type ${JSON.stringify(index.mediaType)}.`);
  if (!Array.isArray(index.manifests) || index.manifests.length === 0) {
    failures.push("Index must contain at least one descriptor.");
    return { valid: false, failures, indexDigest: indexDigest ?? null, platforms };
  }
  if (!manifests || typeof manifests !== "object" || Array.isArray(manifests)) failures.push("Child manifests must be an object keyed by digest.");
  if (!configs || typeof configs !== "object" || Array.isArray(configs)) failures.push("Child configs must be an object keyed by digest.");

  const runnable = [];
  const seenDigests = new Set();
  for (const [position, descriptor] of index.manifests.entries()) {
    if (!descriptor || typeof descriptor !== "object") {
      failures.push(`Malformed descriptor at position ${position}.`);
      continue;
    }
    if (typeof descriptor.digest !== "string" || !DIGEST.test(descriptor.digest)) {
      failures.push(`Invalid descriptor digest at position ${position}.`);
      continue;
    }
    if (!MANIFEST_TYPES.has(descriptor.mediaType)) {
      failures.push(`Descriptor ${descriptor.digest} has unsupported media type ${JSON.stringify(descriptor.mediaType)}.`);
    }
    if (!Number.isInteger(descriptor.size) || descriptor.size <= 0) {
      failures.push(`Descriptor ${descriptor.digest} has an invalid size.`);
    }
    if (seenDigests.has(descriptor.digest)) {
      failures.push(`Duplicate descriptor digest ${descriptor.digest}.`);
      continue;
    }
    seenDigests.add(descriptor.digest);

    if (isAttestation(descriptor)) {
      if (descriptor.platform?.os !== "unknown" || descriptor.platform?.architecture !== "unknown") {
        failures.push(`Attestation descriptor ${descriptor.digest} must use the unknown/unknown platform.`);
      }
      continue;
    }

    const platform = normalizePlatform(descriptor.platform);
    if (!platform) {
      if (descriptor.platform?.os === "unknown" || descriptor.platform?.architecture === "unknown") {
        failures.push(`Unrecognized metadata descriptor ${descriptor.digest}.`);
      } else {
        failures.push(`Unsupported runnable platform ${formatPlatform(descriptor.platform)} at ${descriptor.digest}.`);
      }
      continue;
    }
    runnable.push({ descriptor, platform });
  }

  for (const platform of expected) {
    const matches = runnable.filter((item) => item.platform === platform);
    if (matches.length !== 1) {
      failures.push(`Expected exactly one ${platform} manifest; found ${matches.length}.`);
      continue;
    }
    const { descriptor } = matches[0];
    const before = failures.length;
    const manifest = manifests?.[descriptor.digest];
    if (!manifest || typeof manifest !== "object") {
      failures.push(`Missing manifest ${descriptor.digest} for ${platform}.`);
      continue;
    }
    if (manifest.schemaVersion !== 2) failures.push(`Manifest ${descriptor.digest} schemaVersion must be 2.`);
    if (!MANIFEST_TYPES.has(manifest.mediaType)) {
      failures.push(`Manifest ${descriptor.digest} has unsupported media type ${JSON.stringify(manifest.mediaType)}.`);
    }
    if (manifest.mediaType !== descriptor.mediaType) {
      failures.push(`Manifest ${descriptor.digest} media type ${JSON.stringify(manifest.mediaType)} does not match descriptor ${JSON.stringify(descriptor.mediaType)}.`);
    }
    if (!Array.isArray(manifest.layers)) {
      failures.push(`Manifest ${descriptor.digest} must include a layers array.`);
    } else {
      for (const [index, layer] of manifest.layers.entries()) {
        if (!layer || typeof layer !== "object") {
          failures.push(`Manifest ${descriptor.digest} layer ${index} is malformed.`);
          continue;
        }
        if (typeof layer.digest !== "string" || !DIGEST.test(layer.digest)) {
          failures.push(`Manifest ${descriptor.digest} layer ${index} has an invalid digest.`);
        }
        if (!Number.isInteger(layer.size) || layer.size <= 0) {
          failures.push(`Manifest ${descriptor.digest} layer ${index} has an invalid size.`);
        }
        if (!LAYER_TYPES.has(layer.mediaType)) {
          failures.push(`Manifest ${descriptor.digest} layer ${index} has unsupported media type ${JSON.stringify(layer.mediaType)}.`);
        }
      }
    }
    const configRef = manifest.config;
    if (!configRef || typeof configRef !== "object" || typeof configRef.digest !== "string" || !DIGEST.test(configRef.digest)) {
      failures.push(`Manifest ${descriptor.digest} has an invalid config digest.`);
      continue;
    }
    if (!Number.isInteger(configRef.size) || configRef.size <= 0) {
      failures.push(`Manifest ${descriptor.digest} config descriptor has an invalid size.`);
    }
    if (!CONFIG_TYPES.has(configRef.mediaType)) {
      failures.push(`Manifest ${descriptor.digest} has unsupported config media type ${JSON.stringify(configRef.mediaType)}.`);
    }
    const config = configs?.[configRef.digest];
    if (!config || typeof config !== "object") {
      failures.push(`Missing config ${configRef.digest} for ${platform}.`);
      continue;
    }
    if (normalizePlatform(config) !== platform) {
      failures.push(`Config ${configRef.digest} platform ${formatPlatform(config)} does not match ${platform}.`);
    }
    const revision = config.config?.Labels?.[REVISION_LABEL];
    if (typeof revision !== "string" || revision !== expectedRevision) {
      failures.push(`Config ${configRef.digest} revision ${JSON.stringify(revision)} does not match expected ${expectedRevision}.`);
    }
    const rootfs = config.rootfs;
    if (!rootfs || typeof rootfs !== "object") {
      failures.push(`Config ${configRef.digest} must include rootfs metadata.`);
    } else {
      if (rootfs.type !== "layers") {
        failures.push(`Config ${configRef.digest} rootfs type ${JSON.stringify(rootfs.type)} must be "layers".`);
      }
      if (!Array.isArray(rootfs.diff_ids)) {
        failures.push(`Config ${configRef.digest} must include a rootfs.diff_ids array.`);
      } else {
        for (const [index, diffId] of rootfs.diff_ids.entries()) {
          if (typeof diffId !== "string" || !DIGEST.test(diffId)) {
            failures.push(`Config ${configRef.digest} rootfs.diff_ids entry ${index} is not a sha256 digest.`);
          }
        }
        if (Array.isArray(manifest.layers) && rootfs.diff_ids.length !== manifest.layers.length) {
          failures.push(`Config ${configRef.digest} rootfs.diff_ids count ${rootfs.diff_ids.length} does not match layer count ${manifest.layers.length}.`);
        }
      }
    }
    if (failures.length === before) {
      platforms.push({ platform, manifestDigest: descriptor.digest, configDigest: configRef.digest });
    }
  }

  for (const item of runnable) {
    if (!expected.has(item.platform)) failures.push(`Unexpected runnable platform ${item.platform}.`);
  }

  const order = [...expected];
  platforms.sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
  return { valid: failures.length === 0, failures, indexDigest: indexDigest ?? null, platforms };
}
