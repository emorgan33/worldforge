import { createHash } from "node:crypto";
import { evaluateReleaseManifest } from "./docker-release-policy.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

class RegistryError extends Error {}

async function request(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    throw new RegistryError(`Registry request failed: ${error instanceof Error ? error.message : "network error"}.`);
  }
}

async function json(response, label) {
  try {
    return await response.json();
  } catch {
    throw new RegistryError(`Registry ${label} response was not valid JSON.`);
  }
}

async function verifiedJson(response, claimedDigest, label) {
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new RegistryError(`Could not read the registry ${label} response.`);
  }
  const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualDigest !== claimedDigest) {
    throw new RegistryError(`Registry ${label} digest mismatch: expected ${claimedDigest}, received ${actualDigest}.`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RegistryError(`Registry ${label} response was not valid JSON.`);
  }
}

async function resolve(options) {
  const {
    fetchImpl = globalThis.fetch,
    registry = "https://registry-1.docker.io",
    repository,
    tokenUrl,
    reference,
    expectedRevision,
    expectedPlatforms = ["linux/amd64", "linux/arm64"],
  } = options ?? {};

  if (typeof fetchImpl !== "function") throw new RegistryError("A fetch implementation is required.");
  if (typeof repository !== "string" || !/^[a-z0-9][a-z0-9._/-]*$/.test(repository)) {
    throw new RegistryError("A valid Docker repository is required.");
  }
  if (typeof tokenUrl !== "string" || !/^https?:\/\//.test(tokenUrl)) {
    throw new RegistryError("A valid registry token URL is required.");
  }
  if (typeof reference !== "string" || (!TAG.test(reference) && !DIGEST.test(reference))) {
    throw new RegistryError("A valid image tag or digest is required.");
  }
  if (typeof expectedRevision !== "string" || !REVISION.test(expectedRevision)) {
    throw new RegistryError("Expected revision must be a full lowercase 40-character commit SHA.");
  }
  if (typeof registry !== "string" || !/^https?:\/\//.test(registry)) {
    throw new RegistryError("A valid registry URL is required.");
  }
  const base = registry.replace(/\/+$/, "");
  const manifestUrl = (value) => `${base}/v2/${repository}/manifests/${value}`;
  const blobUrl = (value) => `${base}/v2/${repository}/blobs/${value}`;

  const tokenResponse = await request(fetchImpl, tokenUrl, { headers: { Accept: "application/json" } });
  if (!tokenResponse.ok) {
    throw new RegistryError(`Registry token request failed with HTTP ${tokenResponse.status}.`);
  }
  const tokenBody = await json(tokenResponse, "token");
  const token = tokenBody?.token ?? tokenBody?.access_token;
  if (typeof token !== "string" || !token) throw new RegistryError("Registry token response did not include a token.");

  const headers = { Authorization: `Bearer ${token}`, Accept: ACCEPT, "Accept-Encoding": "identity" };
  const indexResponse = await request(fetchImpl, manifestUrl(reference), { headers });
  if (indexResponse.status === 404) return { status: "absent" };
  if (!indexResponse.ok) {
    throw new RegistryError(`Registry manifest request failed with HTTP ${indexResponse.status}.`);
  }
  const indexDigest = indexResponse.headers.get("docker-content-digest");
  if (!indexDigest) throw new RegistryError("Registry response did not include Docker-Content-Digest.");
  if (!DIGEST.test(indexDigest)) throw new RegistryError("Registry returned an invalid Docker-Content-Digest.");
  const index = await verifiedJson(indexResponse, indexDigest, "manifest index");

  const manifests = {};
  const configs = {};
  const descriptors = Array.isArray(index?.manifests) ? index.manifests : [];
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== "object") continue;
    if (descriptor.platform?.os !== "linux") continue;
    if (descriptor.platform?.architecture !== "amd64" && descriptor.platform?.architecture !== "arm64") continue;
    if (typeof descriptor.digest !== "string" || !DIGEST.test(descriptor.digest)) continue;
    if (manifests[descriptor.digest]) continue;

    const childResponse = await request(fetchImpl, manifestUrl(descriptor.digest), { headers });
    if (!childResponse.ok) {
      throw new RegistryError(`Registry child manifest request failed with HTTP ${childResponse.status}.`);
    }
    const child = await verifiedJson(childResponse, descriptor.digest, "child manifest");
    manifests[descriptor.digest] = child;

    const configDigest = child?.config?.digest;
    if (typeof configDigest === "string" && DIGEST.test(configDigest) && !configs[configDigest]) {
      const configResponse = await request(fetchImpl, blobUrl(configDigest), {
        headers: { Authorization: `Bearer ${token}`, Accept: "*/*", "Accept-Encoding": "identity" },
      });
      if (!configResponse.ok) {
        throw new RegistryError(`Registry config request failed with HTTP ${configResponse.status}.`);
      }
      configs[configDigest] = await verifiedJson(configResponse, configDigest, "image config");
    }
  }

  const result = evaluateReleaseManifest({
    index,
    manifests,
    configs,
    expectedRevision,
    expectedPlatforms,
    indexDigest,
  });
  return result.valid
    ? { status: "existing", indexDigest, platforms: result.platforms }
    : { status: "invalid", failures: result.failures };
}

export async function resolveRelease(options) {
  try {
    return await resolve(options);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
