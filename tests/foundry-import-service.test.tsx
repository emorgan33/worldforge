import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "worldforge-foundry-"));
const databasePath = join(temp, "foundry-test.db");
closeSync(openSync(databasePath, "a"));
process.env.DATABASE_URL = `file:${databasePath}`;
execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { encoding: "utf8", env: process.env });
import type { FoundryCandidate, FoundryMetadata } from "@/lib/foundry/types";
let prisma: typeof import("@/lib/db").prisma;
let boundedFoundryJson: typeof import("@/lib/foundry/import").boundedFoundryJson;
let createSelectedImport: typeof import("@/lib/foundry/import").createSelectedImport;
let getPreviewItems: typeof import("@/lib/foundry/import").getPreviewItems;
let storePreview: typeof import("@/lib/foundry/import").storePreview;

let userId: string;
let otherUserId: string;
let worldId: string;
let otherWorldId: string;
let stamp: number;
const metadata: FoundryMetadata = { system: "pf2e", systemVersion: "8.6.1", foundryVersion: "14.369", remaster: true, namespace: "test-pack" };

function candidate(index: number, overrides: Partial<FoundryCandidate> = {}): FoundryCandidate {
  return {
    id: `candidate-${index}`, name: `Item ${index}`, type: "equipment", source: "test.json",
    sourceIdentity: JSON.stringify([metadata.namespace, `Item.${index}`]), sourceHash: `source-hash-${index}`,
    sourceDocument: { _id: `${index}`, name: `Item ${index}`, secret: "private raw source" },
    systemVersion: metadata.systemVersion, foundryVersion: metadata.foundryVersion, supported: true,
    warnings: [], category: "ITEM", stats: { description: `Description ${index}` }, ...overrides,
  };
}

before(async () => {
  ({ prisma } = await import("@/lib/db"));
  ({ boundedFoundryJson, createSelectedImport, getPreviewItems, storePreview } = await import("@/lib/foundry/import"));
  stamp = Date.now();
  userId = (await prisma.user.create({ data: { name: "Foundry Test", email: `foundry-${stamp}@example.invalid` } })).id;
  otherUserId = (await prisma.user.create({ data: { name: "Other Foundry Test", email: `foundry-other-${stamp}@example.invalid` } })).id;
  worldId = (await prisma.world.create({ data: { ownerId: userId, title: "PF2 World", slug: `foundry-pf-${stamp}`, system: "PF_2E" } })).id;
  otherWorldId = (await prisma.world.create({ data: { ownerId: userId, title: "Other PF2 World", slug: `foundry-pf-other-${stamp}`, system: "PF_2E" } })).id;
});

after(async () => {
  if (worldId) await prisma.world.deleteMany({ where: { id: { in: [worldId, otherWorldId] } } });
  if (userId || otherUserId) await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
  await prisma.$disconnect();
  rmSync(temp, { recursive: true, force: true });
});

test("bounded JSON reader rejects oversized streams before parsing", async () => {
  const request = new Request("http://local.test", { method: "POST", body: "123456789" });
  await assert.rejects(() => boundedFoundryJson(request, 8), (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 413));
});

test("a 1,000-item preview imports only three explicitly selected IDs", async () => {
  const items = Array.from({ length: 1000 }, (_, index) => candidate(index));
  const preview = await storePreview({ worldId, authorId: userId, metadata, candidates: items });
  assert.equal(preview.items.length, 1000);
  assert.equal("sourceDocument" in preview.items[0], false);
  const result = await createSelectedImport({ worldId, authorId: userId, previewId: preview.id, candidateIds: [items[4].id, items[501].id, items[999].id], idempotencyKey: `select-3-${stamp}` });
  assert.ok("run" in result);
  if (!("run" in result)) return;
  assert.equal(result.run!.outcomes.length, 3);
  assert.ok(result.run!.outcomes.every((outcome: { status: string }) => outcome.status === "created"));
  assert.equal(await prisma.rpgBlock.count({ where: { worldId } }), 3);
  const saved = await prisma.foundryProvenance.findMany({ where: { worldId } });
  assert.equal(saved.length, 3);
  assert.ok(saved.every(record => record.sourceDocumentJson.includes("private raw source")));
  const exported = await prisma.rpgBlock.findMany({ where: { worldId } });
  assert.ok(exported.every(block => block.system === "PF_2E"));
});

test("tampered selections, foreign owners, and cross-world previews are rejected", async () => {
  const preview = await storePreview({ worldId, authorId: userId, metadata, candidates: [candidate(2001)] });
  const tampered = await createSelectedImport({ worldId, authorId: userId, previewId: preview.id, candidateIds: ["not-in-preview"], idempotencyKey: `tamper-${stamp}` });
  assert.ok("error" in tampered);
  const foreign = await createSelectedImport({ worldId, authorId: otherUserId, previewId: preview.id, candidateIds: ["candidate-2001"], idempotencyKey: `foreign-${stamp}` });
  assert.ok("error" in foreign);
  assert.equal(await getPreviewItems(otherWorldId, userId, preview.id), null);
  assert.equal(await getPreviewItems(worldId, otherUserId, preview.id), null);
  assert.equal(await prisma.rpgBlock.count({ where: { worldId } }), 3);
});

test("same idempotency key cannot be rebound; repeat source import skips and preserves edits", async () => {
  const original = candidate(3001);
  const first = await storePreview({ worldId, authorId: userId, metadata, candidates: [original] });
  const firstRun = await createSelectedImport({ worldId, authorId: userId, previewId: first.id, candidateIds: [original.id], idempotencyKey: `retry-${stamp}` });
  assert.ok("run" in firstRun);
  if (!("run" in firstRun)) return;
  assert.equal(firstRun.run!.outcomes[0].status, "created");
  const blockId = firstRun.run!.outcomes[0].blockId!;
  await prisma.rpgBlock.update({ where: { id: blockId }, data: { name: "Locally edited item" } });
  const sameRequest = await createSelectedImport({ worldId, authorId: userId, previewId: first.id, candidateIds: [original.id], idempotencyKey: `retry-${stamp}` });
  assert.ok("run" in sameRequest);
  if ("run" in sameRequest) assert.equal(sameRequest.run!.id, firstRun.run!.id);
  const rebound = await createSelectedImport({ worldId, authorId: userId, previewId: first.id, candidateIds: ["candidate-4"], idempotencyKey: `retry-${stamp}` });
  assert.ok("error" in rebound);
  const changed = candidate(3001, { sourceHash: "source-updated" });
  const second = await storePreview({ worldId, authorId: userId, metadata, candidates: [changed] });
  const secondItems = await getPreviewItems(worldId, userId, second.id);
  assert.equal(secondItems?.items[0].status, "changed");
  assert.equal(secondItems?.items[0].destinationEdited, true);
  const skipped = await createSelectedImport({ worldId, authorId: userId, previewId: second.id, candidateIds: [changed.id], idempotencyKey: `skip-edit-${stamp}` });
  assert.ok("run" in skipped);
  if ("run" in skipped) assert.equal(skipped.run!.outcomes[0].status, "skipped");
  assert.equal((await prisma.rpgBlock.findUnique({ where: { id: blockId } }))?.name, "Locally edited item");
});

test("concurrent requests with the same key converge on one durable entry and outcome", async () => {
  const item = candidate(4001);
  const preview = await storePreview({ worldId, authorId: userId, metadata, candidates: [item] });
  const request = { worldId, authorId: userId, previewId: preview.id, candidateIds: [item.id], idempotencyKey: `concurrent-${stamp}` };
  const results = await Promise.all([createSelectedImport(request), createSelectedImport(request)]);
  assert.ok(results.every(result => "run" in result));
  const blocks = await prisma.rpgBlock.findMany({ where: { worldId, name: item.name } });
  assert.equal(blocks.length, 1);
  const run = await prisma.foundryImportRun.findUnique({ where: { worldId_authorId_idempotencyKey: { worldId, authorId: userId, idempotencyKey: request.idempotencyKey } } });
  assert.ok(run);
  const outcomes = await prisma.foundryImportOutcome.findMany({ where: { runId: run!.id, candidateId: item.id } });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "created");
  assert.equal(run!.status, "COMPLETED");
});

test("an interrupted RUNNING run recovers its durable outcome without creating a duplicate", async () => {
  const item = candidate(5001);
  const preview = await storePreview({ worldId, authorId: userId, metadata, candidates: [item] });
  const request = { worldId, authorId: userId, previewId: preview.id, candidateIds: [item.id], idempotencyKey: `interrupted-${stamp}` };
  const first = await createSelectedImport(request);
  assert.ok("run" in first);
  if (!("run" in first)) return;
  await prisma.foundryImportRun.update({ where: { id: first.run!.id }, data: { status: "RUNNING", outcomesJson: "[]" } });

  const recovered = await createSelectedImport(request);
  assert.ok("run" in recovered);
  if (!("run" in recovered)) return;
  assert.equal(recovered.run!.status, "completed");
  assert.deepEqual(recovered.run!.outcomes.map((outcome: { candidateId: string; status: string }) => ({ candidateId: outcome.candidateId, status: outcome.status })), [{ candidateId: item.id, status: "created" }]);
  assert.equal(await prisma.rpgBlock.count({ where: { worldId, name: item.name } }), 1);
  assert.equal(await prisma.foundryImportOutcome.count({ where: { runId: first.run!.id, candidateId: item.id } }), 1);
  await prisma.foundryImportRun.update({ where: { id: first.run!.id }, data: { outcomesJson: "[]" } });
  const completedReplay = await createSelectedImport(request);
  assert.ok("run" in completedReplay);
  if ("run" in completedReplay) assert.deepEqual(completedReplay.run!.outcomes.map((outcome: { candidateId: string; status: string }) => [outcome.candidateId, outcome.status]), [[item.id, "created"]]);
});

test("expired previews are rejected at import time", async () => {
  const item = candidate(5002);
  const preview = await storePreview({ worldId, authorId: userId, metadata, candidates: [item] });
  await prisma.foundryPreview.update({ where: { id: preview.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  const result = await createSelectedImport({ worldId, authorId: userId, previewId: preview.id, candidateIds: [item.id], idempotencyKey: `expired-${stamp}` });
  assert.ok("error" in result);
  if ("error" in result) assert.equal(result.status, 404);
  assert.equal(await prisma.rpgBlock.count({ where: { worldId, name: item.name } }), 0);
});

test("partial failures persist and retrying only the failed entry preserves successes", async () => {
  const successful = candidate(5003, { name: "Partial success item" });
  const failing = candidate(5004, { name: "Partial failure item" });
  const preview = await storePreview({ worldId, authorId: userId, metadata, candidates: [successful, failing] });
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_partial_failure BEFORE INSERT ON RpgBlock WHEN NEW.name = 'Partial failure item' BEGIN SELECT RAISE(ABORT, 'forced test failure'); END`);
  let first;
  try {
    first = await createSelectedImport({ worldId, authorId: userId, previewId: preview.id, candidateIds: [successful.id, failing.id], idempotencyKey: `partial-${stamp}` });
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS reject_partial_failure");
  }
  assert.ok("run" in first);
  if (!("run" in first)) return;
  assert.deepEqual(first.run!.outcomes.map((outcome: { candidateId: string; status: string }) => [outcome.candidateId, outcome.status]), [[successful.id, "created"], [failing.id, "failed"]]);

  const retried = await createSelectedImport({ worldId, authorId: userId, previewId: preview.id, candidateIds: [failing.id], idempotencyKey: `partial-retry-${stamp}` });
  assert.ok("run" in retried);
  if (!("run" in retried)) return;
  assert.deepEqual(retried.run!.outcomes.map((outcome: { candidateId: string; status: string }) => [outcome.candidateId, outcome.status]), [[failing.id, "created"]]);
  assert.equal(await prisma.rpgBlock.count({ where: { worldId, name: successful.name } }), 1);
  assert.equal(await prisma.rpgBlock.count({ where: { worldId, name: failing.name } }), 1);
  assert.equal(await prisma.foundryProvenance.count({ where: { worldId, sourceIdentity: successful.sourceIdentity } }), 1);
});
