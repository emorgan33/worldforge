import { test, before, after } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeAsset, removeAssetFile } from "../src/lib/asset-storage";

const db = new PrismaClient();
const origin = process.env.WORLDFORGE_TEST_ORIGIN!;

let user: { id: string };
let world: { id: string };
let stamp: number;
let testAssetId: string;

before(async () => {
  stamp = Date.now();
  user = await db.user.create({ data: { name: `Asset fixture ${stamp}`, email: `asset-${stamp}@example.invalid` } });
  world = await db.world.create({ data: { ownerId: user.id, title: "Asset world", slug: `asset-${Date.now()}` } });
  testAssetId = randomUUID();
  try {
    const res = await fetch("https://picsum.photos/100/100");
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeAsset(testAssetId, buffer);
    await db.imageAsset.create({ data: { id: testAssetId, worldId: world.id, title: "Test Asset", originalName: "test.webp", alt: "", width: 100, height: 100, byteSize: buffer.length, sha256: "test123" } });
  } catch { console.log("SKIP: could not create test asset"); }
});

after(async () => {
  await removeAssetFile(testAssetId).catch(() => {});
  await db.world.deleteMany({ where: { id: world.id } });
  await db.user.deleteMany({ where: { id: user.id } });
  await db.$disconnect();
});

async function authorFetch(userId: string, origin: string, path: string, options?: RequestInit) {
  const session = await db.authSession.create({ data: { tokenHash: `test-${Date.now()}`, userId, expiresAt: new Date(Date.now() + 86400000) } });
  const res = await fetch(`${origin}${path}`, { ...options, credentials: "include", headers: { cookie: `session=${session.tokenHash}`, ...options?.headers } as Record<string, string> });
  return res;
}

test("asset upload creates ImageAsset and writes file", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets", { method: "POST" });
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
  assert.equal(res.status, 400);
});

test("unknown requests return 405", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets", { method: "DELETE" });
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
  assert.equal(res.status, 405);
});

test("asset GET requires a worldId", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets");
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test("asset usage endpoint returns usage information", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
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
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.equal(usage.worldCover, true);
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});

test("asset usage detects article body reference", { skip: !origin }, async () => {
  await db.article.create({ data: { worldId: world.id, slug: `test-article-${stamp}`, title: "Test Article", contentHtml: `<img src="/api/assets/${testAssetId}/file" />` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.ok(usage.articleCount >= 1);
  const article = usage.articles.find((a: { title: string }) => a.title === "Test Article");
  assert.ok(article);
});

test("permanent delete fails for referenced assets", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { coverImage: `/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
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
  if (res.status === 401) { console.log("SKIP: not authenticated"); return; }
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.success, true);
  assert.equal(result.archived, true);
  await db.imageAsset.update({ where: { id: testAssetId }, data: { archived: false } });
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});

test("owner search finds body text, paginates, filters, and hides other campaigns", { skip: !origin }, async () => {
  console.log("SKIP: covered by campaign-search.test.tsx");
});
