import { test, before, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const db = new PrismaClient();
const origin = process.env.WORLDFORGE_TEST_ORIGIN;
let authenticatedFetch: fetcherType;
type fetcherType = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let ownerId: string;
let worldId: string;
let stamp: number;

before(async () => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  stamp = Date.now();
  ownerId = (await db.user.create({ data: { name: `Export Fixture ${stamp}`, email: `export-${stamp}@example.invalid` } })).id;
  if (origin) authenticatedFetch = await authorFetch(db, ownerId, origin);
  worldId = (await db.world.create({ data: { ownerId, title: `Export World ${stamp}`, slug: `export-${stamp}` } })).id;
});

after(async () => {
  if (!origin) { await db.$disconnect(); return; }
  if (worldId) await db.world.deleteMany({ where: { id: worldId } });
  if (ownerId) await db.user.deleteMany({ where: { id: ownerId } });
  await db.$disconnect();
});

function ownerFetch(path: string, options?: RequestInit) {
  if (!origin) throw new Error("WORLDFORGE_TEST_ORIGIN is required");
  return authenticatedFetch(`${origin}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
}

test("world export defaults to format 3 with a complete structure", { skip: !origin }, async () => {
  const res = await ownerFetch(`/api/worlds/${worldId}/export`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Accept-Version"), "3");
  const data = await res.json();
  assert.equal(data.formatVersion, 3);
  assert.ok(data.exportedAt);
  assert.ok(data.world);
  assert.ok(Array.isArray(data.categories));
  assert.ok(Array.isArray(data.articles));
  assert.ok(Array.isArray(data.assets));
  assert.equal(data.world.id, worldId);
  assert.equal(data.world.title, `Export World ${stamp}`);
});

test("format 3 rejects filtering flags instead of silently returning a partial backup", { skip: !origin }, async () => {
  for (const flag of ["includeAssets=false", "includePrivate=false"]) {
    const res = await ownerFetch(`/api/worlds/${worldId}/export?${flag}`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /complete backup/i);
  }
  const bad = await ownerFetch(`/api/worlds/${worldId}/export?format=v9`);
  assert.equal(bad.status, 400);
});

test("legacy v1 and v2 exports remain available for lossless worlds", { skip: !origin }, async () => {
  const v1 = await ownerFetch(`/api/worlds/${worldId}/export?format=v1&includeAssets=false`);
  assert.equal(v1.status, 200);
  const v1Data = await v1.json();
  assert.equal(v1Data.version, 1);
  const v2 = await ownerFetch(`/api/worlds/${worldId}/export?format=v2`);
  assert.equal(v2.status, 200);
  assert.equal((await v2.json()).formatVersion, 2);
});

test("legacy export is refused when it would drop provenance or placement data", { skip: !origin }, async () => {
  const assetId = randomUUID();
  await db.imageAsset.create({ data: { id: assetId, worldId, title: "Provenance art", originalName: "art.webp", mimeType: "image/webp", byteSize: 1, width: 1, height: 1, sha256: "e".repeat(64), source: "STOCK" } });
  await db.imageAssetProvenance.create({ data: { assetId, catalogEntryId: "moonlit-keep", catalogVersion: 1, manifestDigest: "f".repeat(64), snapshotJson: "{}", verificationOrigin: "BUNDLED_REVIEW" } });
  const res = await ownerFetch(`/api/worlds/${worldId}/export?format=v2`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /format=v3/i);
  await db.imageAssetProvenance.deleteMany({ where: { assetId } });
  await db.imageAsset.deleteMany({ where: { id: assetId } });
});

test("v2 refuses filtering flags instead of including omitted private data", { skip: !origin }, async () => {
  for (const flag of ["includeAssets=false", "includePrivate=false", "includePrivate=true"]) {
    const response = await ownerFetch(`/api/worlds/${worldId}/export?format=v2&${flag}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /format=v1/);
  }
});

test("legacy v1 import does not silently discard attached provenance", { skip: !origin }, async () => {
  const bundle = await (await ownerFetch(`/api/worlds/${worldId}/export?format=v1`)).json();
  bundle.assets = [{ data: "", provenance: [{ snapshotJson: "not JSON" }] }];
  const response = await ownerFetch("/api/worlds/import", { method: "POST", body: JSON.stringify(bundle) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /cannot preserve image provenance/);
});

test("v2 and v3 retain empty world title compatibility while v1 rejects it", { skip: !origin }, async () => {
  for (const format of ["v2", "v3"] as const) {
    const exported = await ownerFetch(`/api/worlds/${worldId}/export?format=${format}`);
    assert.equal(exported.status, 200);
    const bundle = await exported.json();
    bundle.world.title = "";
    const response = await ownerFetch("/api/worlds/import", { method: "POST", body: JSON.stringify(bundle) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    const restored = await db.world.findUnique({ where: { id: result.worldId }, select: { title: true, isPublic: true } });
    assert.deepEqual(restored, { title: "", isPublic: false });
    await db.world.delete({ where: { id: result.worldId } });
  }

  const legacy = await ownerFetch(`/api/worlds/${worldId}/export?format=v1`);
  const bundle = await legacy.json();
  bundle.world.title = "";
  const rejected = await ownerFetch("/api/worlds/import", { method: "POST", body: JSON.stringify(bundle) });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /missing world information/i);
});

test("legacy API refuses a world whose new placement data exists only in history", { skip: !origin }, async () => {
  const article = await db.article.create({ data: { worldId, title: "Historical placement", slug: `historical-${stamp}` } });
  try {
    await db.articleRevision.create({ data: { articleId: article.id, userId: ownerId, title: article.title, slug: article.slug, articleVersionAtSave: 1, coverImageAlt: "Earlier cover", publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT" } });
    for (const format of ["v1", "v2"]) {
      assert.equal((await ownerFetch(`/api/worlds/${worldId}/export?format=${format}`)).status, 400);
    }
  } finally { await db.article.delete({ where: { id: article.id } }); }
});

test("world export is private by default regardless of original setting", { skip: !origin }, async () => {
  await db.world.update({ where: { id: worldId }, data: { isPublic: true } });
  const res = await ownerFetch(`/api/worlds/${worldId}/export`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.world.isPublic, false);
});

test("world export excludes private content when requested", { skip: !origin }, async () => {
  // Create private article
  await db.article.create({ data: { worldId, slug: `private-${stamp}`, title: "Private", publicationStatus: "DRAFT", visibility: "PRIVATE", contentHtml: "secret" } });
  // Create public article
  await db.article.create({ data: { worldId, slug: `public-${stamp}`, title: "Public", publicationStatus: "PUBLISHED", visibility: "PUBLIC", contentHtml: "visible" } });
  
  const res = await ownerFetch(`/api/worlds/${worldId}/export?format=v1&includePrivate=false`);
  assert.equal(res.status, 200);
  const data = await res.json();
  const articleTitles = data.articles.map((a: { title: string }) => a.title);
  assert.ok(articleTitles.includes("Public"));
  assert.ok(!articleTitles.includes("Private"));
  assert.ok(data.articles.every((a: { publicationStatus: string }) => a.publicationStatus === "DRAFT"));
});

test("world import creates new world with remapped IDs", { skip: !origin }, async () => {
  // First export
  const exportRes = await ownerFetch(`/api/worlds/${worldId}/export?format=v1&includeAssets=false&includePrivate=true`);
  assert.equal(exportRes.status, 200);
  const exportData = await exportRes.json();
  
  // Add a category to the export
  exportData.categories = [{ id: "cat-1", parentId: null, name: "Test Category", icon: "book", order: 0 }];
  exportData.articles[0].categoryId = "cat-1";
  
  // Import
  const importRes = await ownerFetch("/api/worlds/import", {
    method: "POST",
    body: JSON.stringify(exportData),
  });
  assert.equal(importRes.status, 200);
  const importResult = await importRes.json();
  assert.equal(importResult.success, true);
  assert.ok(importResult.worldId);
  assert.notEqual(importResult.worldId, worldId);
  assert.equal(importResult.imported.categories, 1);
  
  // Verify imported world exists
  const importedWorld = await db.world.findUnique({ where: { id: importResult.worldId } });
  assert.ok(importedWorld);
  assert.equal(importedWorld.title, `Export World ${stamp}`);
  assert.equal(importedWorld.isPublic, false);
  const importedArticles = await db.article.findMany({ where: { worldId: importResult.worldId } });
  assert.ok(importedArticles.length > 0);
  assert.ok(importedArticles.every(article => article.publicationStatus === "DRAFT" && article.visibility === "PRIVATE"));
  
  // Verify category was imported with remapped ID
  const categories = await db.category.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, "Test Category");
  
  // Cleanup
  await db.world.delete({ where: { id: importResult.worldId } });
});

test("world import generates unique slug on conflict", { skip: !origin }, async () => {
  const exportRes = await ownerFetch(`/api/worlds/${worldId}/export?format=v1&includeAssets=false`);
  const exportData = await exportRes.json();
  
  // Import twice
  const import1 = await ownerFetch("/api/worlds/import", { method: "POST", body: JSON.stringify(exportData) });
  const result1 = await import1.json();
  assert.ok(result1.warnings);
  assert.ok(result1.warnings.some((w: string) => w.includes("renamed")));
  
  const import2 = await ownerFetch("/api/worlds/import", { method: "POST", body: JSON.stringify({ ...exportData, exportedAt: new Date().toISOString() }) });
  const result2 = await import2.json();
  assert.ok(result2.warnings);
  assert.ok(result2.warnings.some((w: string) => w.includes("renamed")));
  
  // Cleanup
  if (result1.worldId) await db.world.delete({ where: { id: result1.worldId } }).catch(() => {});
  if (result2.worldId) await db.world.delete({ where: { id: result2.worldId } }).catch(() => {});
});
