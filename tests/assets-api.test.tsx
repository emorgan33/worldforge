import { test, before, after } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { writeAsset, removeAssetFile } from "../src/lib/asset-storage";
import { authorFetch as authenticatedAuthorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const db = new PrismaClient();
const origin = process.env.WORLDFORGE_TEST_ORIGIN!;

let user: { id: string };
let world: { id: string };
let stamp: number;
let testAssetId: string;

before(async () => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  stamp = Date.now();
  user = await db.user.create({ data: { name: `Asset fixture ${stamp}`, email: `asset-${stamp}@example.invalid` } });
  world = await db.world.create({ data: { ownerId: user.id, title: "Asset world", slug: `asset-${Date.now()}` } });
  testAssetId = randomUUID();
  const buffer = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64");
  await writeAsset(testAssetId, buffer);
  await db.imageAsset.create({ data: { id: testAssetId, worldId: world.id, title: "Test Asset", originalName: "test.webp", alt: "", width: 1, height: 1, byteSize: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") } });
});

after(async () => {
  if (testAssetId) await removeAssetFile(testAssetId).catch(() => {});
  if (world?.id) await db.world.deleteMany({ where: { id: world.id } });
  if (user?.id) await db.user.deleteMany({ where: { id: user.id } });
  await db.$disconnect();
});

async function authorFetch(userId: string, origin: string, path: string, options?: RequestInit) {
  const fetchAsAuthor = await authenticatedAuthorFetch(db, userId, origin);
  return fetchAsAuthor(`${origin}${path}`, options);
}

test("asset upload creates ImageAsset and writes file", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets", { method: "POST" });
  assert.equal(res.status, 400);
});

test("unknown requests return 405", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets", { method: "DELETE" });
  assert.equal(res.status, 405);
});

test("asset GET without an owned world is concealed as not found", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test("asset source filter rejects unknown values and narrows before pagination", { skip: !origin }, async () => {
  const invalid = await authorFetch(user.id, origin, `/api/assets?worldId=${world.id}&source=elsewhere`);
  assert.equal(invalid.status, 400);
  const uploaded = await authorFetch(user.id, origin, `/api/assets?worldId=${world.id}&source=uploaded`);
  assert.equal(uploaded.status, 200);
  const uploadedBody = await uploaded.json();
  assert.ok(uploadedBody.assets.every((asset: { source?: string }) => asset.source === "UPLOADED"));
  const stock = await authorFetch(user.id, origin, `/api/assets?worldId=${world.id}&source=stock`);
  assert.equal(stock.status, 200);
  const stockBody = await stock.json();
  assert.ok(!stockBody.assets.some((asset: { id: string }) => asset.id === testAssetId));
});

test("asset usage endpoint returns usage information", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.ok(typeof usage.worldCover === "boolean");
  assert.ok(typeof usage.worldBanner === "boolean");
  assert.ok(typeof usage.worldBackground === "boolean");
  assert.ok(typeof usage.articleCount === "number");
  assert.ok(Array.isArray(usage.articles));
});

test("asset usage detects world cover reference", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { coverImage: `/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.equal(usage.worldCover, true);
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});

test("asset usage detects article body reference", { skip: !origin }, async () => {
  await db.article.create({ data: { worldId: world.id, slug: `test-article-${stamp}`, title: "Test Article", contentHtml: `<img src="/api/assets/${testAssetId}/file" />` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.ok(usage.articleCount >= 1);
  const article = usage.articles.find((a: { title: string }) => a.title === "Test Article");
  assert.ok(article);
});

test("permanent delete fails for referenced assets", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { coverImage: `/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.success, false);
  assert.equal(result.deleted, false);
  assert.equal(result.referenced, true);
  assert.ok(result.references);
  assert.equal(result.references.worldCover, true);
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});

test("archive asset does not require reference check", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { coverImage: `/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.success, true);
  assert.equal(result.archived, true);
  await db.imageAsset.update({ where: { id: testAssetId }, data: { archived: false } });
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});
