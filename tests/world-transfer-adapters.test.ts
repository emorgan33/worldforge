import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WORLD_TRANSFER_BYTES,
  decodeWorldTransfer,
  isWorldTransferShape,
  readWorldTransferJson,
  toCanonicalWorldTransfer,
  worldTransferLimitError,
  remapWorldAssetUrls,
} from "@/lib/world-transfer-adapters";
import { importWorldTransfer } from "@/lib/world-transfer-execution";

const base = { world: { id: "source", slug: "test", title: "Test", description: null, genre: "Fantasy", system: "DND_5E" }, categories: [], articles: [], assets: [] };

test("remaps absolute library image URLs and preserves external placements", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const urls = new Map([[`/api/assets/${id}/file`, "/api/assets/22222222-2222-4222-8222-222222222222/file"]]);
  const input = `https://old.example/api/assets/${id}/file|https://images.example/cover.webp`;
  assert.equal(remapWorldAssetUrls(input, urls, () => "unexpected"), "/api/assets/22222222-2222-4222-8222-222222222222/file|https://images.example/cover.webp");
});

test("decodes all supported manifest versions and preserves accurate discriminators", () => {
  const v1 = decodeWorldTransfer({ ...base, version: 1 });
  const v2 = decodeWorldTransfer({ ...base, formatVersion: 2 });
  const v3 = decodeWorldTransfer({ ...base, formatVersion: 3 });
  const v4 = decodeWorldTransfer({ ...base, formatVersion: 4 });
  assert.equal(v1?.version, 1);
  assert.equal(v2 && "formatVersion" in v2.bundle ? v2.bundle.formatVersion : null, 2);
  assert.equal(v3 && "formatVersion" in v3.bundle ? v3.bundle.formatVersion : null, 3);
  assert.equal(v4 && "formatVersion" in v4.bundle ? v4.bundle.formatVersion : null, 4);
  assert.equal(toCanonicalWorldTransfer(v3!).sourceVersion, 3);
  assert.equal(decodeWorldTransfer({ ...base, formatVersion: 5 }), null);
});

test("dispatches unsupported and v1-incompatible bundles as client errors before persistence", async () => {
  const unsupported = await importWorldTransfer({ ...base, formatVersion: 5 }, "owner");
  assert.equal(unsupported.success, false);
  if (!unsupported.success) {
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.error, /Unsupported/);
  }

  const provenance = await importWorldTransfer({ ...base, version: 1, assets: [{ id: "a", title: "A", data: "", provenance: [] }] }, "owner");
  assert.equal(provenance.success, false);
  if (!provenance.success) {
    assert.equal(provenance.status, 400);
    assert.match(provenance.error, /provenance/i);
  }
});

test("applies shared section limits before version dispatch", () => {
  assert.equal(isWorldTransferShape({ ...base, formatVersion: 3 }), true);
  assert.equal(isWorldTransferShape({ ...base, formatVersion: 4 }), true);
  assert.equal(isWorldTransferShape({ ...base, articles: new Array(10001) }), false);
  assert.equal(isWorldTransferShape({ ...base, world: { ...base.world, title: "x".repeat(201) } }), false);
  const oversizedAudit = { ...base, formatVersion: 4, auditEvents: new Array(10001).fill({ action: "test" }) };
  assert.equal(isWorldTransferShape(oversizedAudit), false);
  assert.match(worldTransferLimitError(oversizedAudit) ?? "", /auditEvents.*10,000 item import limit/);
});

test("reads valid JSON and rejects oversized declared or streamed bodies", async () => {
  const good = new Request("http://localhost/import", { method: "POST", body: JSON.stringify({ version: 1 }) });
  assert.deepEqual(await readWorldTransferJson(good), { version: 1 });
  const declared = new Request("http://localhost/import", { method: "POST", headers: { "content-length": String(MAX_WORLD_TRANSFER_BYTES + 1) }, body: "{}" });
  await assert.rejects(readWorldTransferJson(declared), /60 MB limit/);
  const streamed = new Request("http://localhost/import", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_WORLD_TRANSFER_BYTES + 1)); controller.close(); } }), duplex: "half" } as RequestInit);
  await assert.rejects(readWorldTransferJson(streamed), /60 MB limit/);
});
