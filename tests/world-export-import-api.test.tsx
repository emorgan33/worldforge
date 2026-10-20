import { test, before, after } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import { authorFetch } from "./auth-fixture";

const db = new PrismaClient();
const origin = process.env.WORLDFORGE_TEST_ORIGIN;
let authenticatedFetch: fetcherType;
type fetcherType = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let ownerId: string;
let worldId: string;
let stamp: number;

before(async () => {
  stamp = Date.now();
  ownerId = (await db.user.create({ data: { name: `Export Fixture ${stamp}`, email: `export-${stamp}@example.invalid` } })).id;
  if (origin) authenticatedFetch = await authorFetch(db, ownerId, origin);
  worldId = (await db.world.create({ data: { ownerId, title: `Export World ${stamp}`, slug: `export-${stamp}` } })).id;
});

after(async () => {
  await db.world.deleteMany({ where: { id: worldId } });
  await db.user.deleteMany({ where: { id: ownerId } });
  await db.$disconnect();
});

function ownerFetch(path: string, options?: RequestInit) {
  if (!origin) throw new Error("WORLDFORGE_TEST_ORIGIN is required");
  return authenticatedFetch(`${origin}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
}

test("world export returns valid JSON structure", { skip: !origin }, async () => {
  const res = await ownerFetch(`/api/worlds/${worldId}/export`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, 1);
  assert.ok(data.exportedAt);
  assert.ok(data.world);
  assert.ok(Array.isArray(data.categories));
  assert.ok(Array.isArray(data.articles));
  assert.ok(Array.isArray(data.assets));
  assert.equal(data.world.id, worldId);
  assert.equal(data.world.title, `Export World ${stamp}`);
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
  
  const res = await ownerFetch(`/api/worlds/${worldId}/export?includePrivate=false`);
  assert.equal(res.status, 200);
  const data = await res.json();
  const articleTitles = data.articles.map((a: { title: string }) => a.title);
  assert.ok(articleTitles.includes("Public"));
  assert.ok(!articleTitles.includes("Private"));
  assert.ok(data.articles.every((a: { publicationStatus: string }) => a.publicationStatus === "DRAFT"));
});

test("world import creates new world with remapped IDs", { skip: !origin }, async () => {
  // First export
  const exportRes = await ownerFetch(`/api/worlds/${worldId}/export?includeAssets=false&includePrivate=true`);
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
  
  // Verify category was imported with remapped ID
  const categories = await db.category.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, "Test Category");
  
  // Cleanup
  await db.world.delete({ where: { id: importResult.worldId } });
});

test("world import generates unique slug on conflict", { skip: !origin }, async () => {
  const exportRes = await ownerFetch(`/api/worlds/${worldId}/export?includeAssets=false`);
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