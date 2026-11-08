import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { resolveRelease } from "../scripts/docker-release-registry.mjs";

type ReleaseResult = {
  status: "absent" | "existing" | "invalid" | "error";
  indexDigest?: string;
  platforms?: Array<{ platform: string; manifestDigest: string; configDigest: string }>;
  failures?: string[];
  message?: string;
};

const revision = "a".repeat(40);
const tokenUrl = "https://auth.example/token";
const registry = "https://registry.example";
const repository = "emorgan33/worldforge";
const tag = "0.4.4";
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const OCI_CONFIG = "application/vnd.oci.image.config.v1+json";
const OCI_LAYER = "application/vnd.oci.image.layer.v1.tar+gzip";
const DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

const manifestUrl = (reference: string) => `${registry}/v2/${repository}/manifests/${reference}`;
const blobUrl = (digestValue: string) => `${registry}/v2/${repository}/blobs/${digestValue}`;

function fixture({ accessToken = false, armRevision = revision } = {}) {
  const descriptors: Array<Record<string, unknown>> = [];
  const manifests: Record<string, Record<string, unknown>> = {};
  const configs: Record<string, Record<string, unknown>> = {};
  const byArch: Record<string, { manifestDigest: string; configDigest: string }> = {};
  const add = (architecture: string, variant?: string) => {
    const layerDigest = sha256(`layer-${architecture}`);
    const config = {
      architecture,
      os: "linux",
      ...(variant ? { variant } : {}),
      rootfs: { type: "layers", diff_ids: [layerDigest] },
      config: { Labels: { "org.opencontainers.image.revision": architecture === "arm64" ? armRevision : revision } },
    };
    const configDigest = sha256(JSON.stringify(config));
    configs[configDigest] = config;
    const manifest = {
      schemaVersion: 2,
      mediaType: OCI_MANIFEST,
      config: { mediaType: OCI_CONFIG, digest: configDigest, size: 50 },
      layers: [{ mediaType: OCI_LAYER, digest: layerDigest, size: 10 }],
    };
    const manifestDigest = sha256(JSON.stringify(manifest));
    manifests[manifestDigest] = manifest;
    byArch[architecture] = { manifestDigest, configDigest };
    descriptors.push({
      mediaType: OCI_MANIFEST,
      digest: manifestDigest,
      size: 100,
      platform: { os: "linux", architecture, ...(variant ? { variant } : {}) },
    });
  };
  add("amd64");
  add("arm64", "v8");
  const attestationDigest = sha256("attestation");
  descriptors.push({
    mediaType: OCI_MANIFEST,
    digest: attestationDigest,
    size: 50,
    platform: { os: "unknown", architecture: "unknown" },
    annotations: { "vnd.docker.reference.type": "attestation-manifest" },
  });
  const index = { schemaVersion: 2, mediaType: OCI_INDEX, manifests: descriptors };
  const indexDigest = sha256(JSON.stringify(index));
  const routes: Record<string, () => Response> = {
    [tokenUrl]: () => json(accessToken ? { access_token: "test-token" } : { token: "test-token" }),
    [manifestUrl(tag)]: () => json(index, { headers: { "docker-content-digest": indexDigest } }),
  };
  for (const [digestValue, manifest] of Object.entries(manifests)) {
    routes[manifestUrl(digestValue)] = () => json(manifest);
  }
  for (const [digestValue, config] of Object.entries(configs)) {
    routes[blobUrl(digestValue)] = () => json(config);
  }
  return { index, indexDigest, manifests, configs, routes, byArch, attestationDigest };
}

async function resolve(routes: Record<string, () => Response>, overrides: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route();
  };
  const result = (await resolveRelease({
    fetchImpl,
    registry,
    repository,
    tokenUrl,
    reference: tag,
    expectedRevision: revision,
    ...overrides,
  })) as ReleaseResult;
  return { result, calls };
}

test("resolves a complete unchanged multi-platform release", async () => {
  const data = fixture();
  const { result, calls } = await resolve(data.routes);
  assert.equal(result.status, "existing");
  assert.equal(result.indexDigest, data.indexDigest);
  assert.deepEqual(result.platforms!.map((item: { platform: string }) => item.platform), ["linux/amd64", "linux/arm64"]);
  assert.ok(calls.filter((call) => call.url !== tokenUrl).every((call) => call.headers.get("authorization") === "Bearer test-token"));
  assert.ok(calls.filter((call) => call.url !== tokenUrl).every((call) => call.headers.get("accept-encoding") === "identity"));
  assert.equal(calls.some((call) => call.url.includes(data.attestationDigest)), false, "attestation metadata must not be fetched");
});

test("accepts access_token token responses", async () => {
  const data = fixture({ accessToken: true });
  const { result } = await resolve(data.routes);
  assert.equal(result.status, "existing");
});

test("reports an absent version on 404", async () => {
  const data = fixture();
  data.routes[manifestUrl(tag)] = () => new Response("missing", { status: 404 });
  const { result } = await resolve(data.routes);
  assert.deepEqual(result, { status: "absent" });
});

test("rejects a single-platform legacy manifest", async () => {
  const data = fixture();
  const legacy = {
    schemaVersion: 2,
    mediaType: DOCKER_MANIFEST,
    config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: sha256("legacy config"), size: 10 },
    layers: [],
  };
  data.routes[manifestUrl(tag)] = () => json(legacy, {
    headers: { "docker-content-digest": sha256(JSON.stringify(legacy)) },
  });
  const { result } = await resolve(data.routes);
  assert.equal(result.status, "invalid");
  assert.match(result.failures!.join("\n"), /Unsupported index media type|at least one descriptor/);
});

test("rejects a release whose child revision differs", async () => {
  const data = fixture({ armRevision: "b".repeat(40) });
  const { result } = await resolve(data.routes);
  assert.equal(result.status, "invalid");
  assert.match(result.failures!.join("\n"), /revision .* does not match expected/);
});

test("fails closed on token, manifest, child and config errors", async () => {
  const token = fixture();
  token.routes[tokenUrl] = () => new Response("denied", { status: 401 });
  assert.match((await resolve(token.routes)).result.message!, /token request failed with HTTP 401/);

  for (const status of [429, 500]) {
    const manifest = fixture();
    manifest.routes[manifestUrl(tag)] = () => new Response("error", { status });
    assert.match((await resolve(manifest.routes)).result.message!, new RegExp(`manifest request failed with HTTP ${status}`));
  }

  const child = fixture();
  child.routes[manifestUrl(child.byArch.amd64.manifestDigest)] = () => new Response("error", { status: 500 });
  assert.match((await resolve(child.routes)).result.message!, /child manifest request failed with HTTP 500/);

  const config = fixture();
  const configDigest = Object.keys(config.configs)[0];
  config.routes[blobUrl(configDigest)] = () => new Response("error", { status: 503 });
  assert.match((await resolve(config.routes)).result.message!, /config request failed with HTTP 503/);
});

test("fails closed on malformed or incomplete registry responses", async () => {
  const malformed = fixture();
  malformed.routes[manifestUrl(tag)] = () => new Response("not json", {
    status: 200,
    headers: { "docker-content-digest": sha256("not json") },
  });
  assert.match((await resolve(malformed.routes)).result.message!, /not valid JSON/);

  const missingDigest = fixture();
  missingDigest.routes[manifestUrl(tag)] = () => json(missingDigest.index);
  assert.match((await resolve(missingDigest.routes)).result.message!, /Docker-Content-Digest/);

  const missingToken = fixture();
  missingToken.routes[tokenUrl] = () => json({});
  assert.match((await resolve(missingToken.routes)).result.message!, /did not include a token/);
});

test("rejects responses whose bytes do not match the claimed digests", async () => {
  const indexMismatch = fixture();
  indexMismatch.routes[manifestUrl(tag)] = () => json(indexMismatch.index, {
    headers: { "docker-content-digest": sha256("different index body") },
  });
  assert.match((await resolve(indexMismatch.routes)).result.message!, /manifest index digest mismatch/);

  const childMismatch = fixture();
  const childDigest = childMismatch.byArch.amd64.manifestDigest;
  childMismatch.routes[manifestUrl(childDigest)] = () => json({
    ...childMismatch.manifests[childDigest],
    extra: true,
  });
  assert.match((await resolve(childMismatch.routes)).result.message!, /child manifest digest mismatch/);

  const configMismatch = fixture();
  const configDigest = configMismatch.byArch.arm64.configDigest;
  configMismatch.routes[blobUrl(configDigest)] = () => json({
    ...configMismatch.configs[configDigest],
    extra: true,
  });
  assert.match((await resolve(configMismatch.routes)).result.message!, /image config digest mismatch/);
});

test("fails closed on network errors without exposing the token", async () => {
  const result = (await resolveRelease({
    fetchImpl: async () => { throw new Error("socket hang up"); },
    registry,
    repository,
    tokenUrl,
    reference: tag,
    expectedRevision: revision,
  })) as ReleaseResult;
  assert.equal(result.status, "error");
  assert.match(result.message!, /network|socket hang up/);
  assert.equal(result.message!.includes("test-token"), false);
});

test("rejects invalid inputs", async () => {
  for (const overrides of [
    { repository: "" },
    { repository: "Owner/Repo" },
    { tokenUrl: "not-a-url" },
    { reference: "" },
    { expectedRevision: "short" },
    { registry: "not-a-url" },
  ]) {
    const data = fixture();
    const { result } = await resolve(data.routes, overrides);
    assert.equal(result.status, "error");
  }
});
