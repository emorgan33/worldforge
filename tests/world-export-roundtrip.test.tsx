import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let db: PrismaClientType;
let exportService: typeof import("../src/lib/world-export");
let normalizeImage: typeof import("../src/lib/asset-storage").normalizeImage;
let writeAsset: typeof import("../src/lib/asset-storage").writeAsset;
let tempDir: string;
let originalDatabaseUrl: string | undefined; let originalAssetDir: string | undefined;
let ownerId: string; let sourceId: string; let stamp: number;
before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "worldforge-roundtrip-"));
  originalDatabaseUrl = process.env.DATABASE_URL; originalAssetDir = process.env.WORLDFORGE_ASSET_DIR;
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(tempDir, "roundtrip.db")}`,
    WORLDFORGE_ASSET_DIR: path.join(tempDir, "assets"),
  });
  await writeFile(path.join(tempDir, "roundtrip.db"), "");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  const [{ PrismaClient }, service, storage] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/world-export"),
    import("../src/lib/asset-storage"),
  ]);
  db = new PrismaClient();
  exportService = service;
  normalizeImage = storage.normalizeImage;
  writeAsset = storage.writeAsset;
  stamp = Date.now();
  ownerId = (await db.user.create({ data: { name: `Roundtrip ${stamp}`, email: `roundtrip-${stamp}@example.invalid` } })).id;
  sourceId = (await db.world.create({ data: { ownerId, title: `Roundtrip ${stamp}`, slug: `roundtrip-${stamp}` } })).id;
});
after(async () => {
  if (!db) { if (tempDir) await rm(tempDir, { recursive: true, force: true }); return; }
  const worlds = await db.world.findMany({ where: { OR: [{ id: sourceId }, { slug: { startsWith: `roundtrip-${stamp}-` } }] }, select: { id: true } });
  const worldIds = worlds.map(world => world.id);
  await db.accessAuditEvent.deleteMany({ where: { worldId: { in: worldIds } } });
  await db.world.deleteMany({ where: { id: { in: worldIds } } });
  await db.user.deleteMany({ where: { id: ownerId } });
  await db.$disconnect();
  await rm(tempDir, { recursive: true, force: true });
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else Object.assign(process.env, { DATABASE_URL: originalDatabaseUrl });
  if (originalAssetDir === undefined) delete process.env.WORLDFORGE_ASSET_DIR; else Object.assign(process.env, { WORLDFORGE_ASSET_DIR: originalAssetDir });
});

test("v2 roundtrip remaps map content and session entity links, and warns on missing links", async () => {
  const article = await db.article.create({ data: { worldId: sourceId, title: "Map target", slug: `map-target-${stamp}` } });
  const parentArticle = await db.article.create({ data: { worldId: sourceId, title: "Parent article", slug: `parent-${stamp}` } });
  const childArticle = await db.article.create({ data: { worldId: sourceId, categoryId: null, parentId: parentArticle.id, title: "Child article", slug: `child-${stamp}` } });
  const linkedJson = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "articleLink", attrs: { articleId: article.id, label: article.title } }] }] });
  await db.article.update({ where: { id: parentArticle.id }, data: {
    contentJson: linkedJson, contentHtml: `<p><span data-article-id="${article.id}">Map target</span></p>`,
    sidebarJson: JSON.stringify({ summary: "Quick fact retained" }), version: 3,
  } });
  await db.articleRevision.create({ data: {
    articleId: parentArticle.id, userId: ownerId, title: "Earlier parent", slug: parentArticle.slug,
    contentJson: linkedJson, contentHtml: `<p><span data-article-id="${article.id}">Map target</span></p>`,
    publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT", articleVersionAtSave: 2,
  } });
  const parentCategory = await db.category.create({ data: { worldId: sourceId, name: "Parent category" } });
  const childCategory = await db.category.create({ data: { worldId: sourceId, parentId: parentCategory.id, name: "Child category" } });
  const sourceAssetId = randomUUID();
  const image = await normalizeImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: "orange" } }).png().toBuffer());
  await writeAsset(sourceAssetId, image.data);
  await db.imageAsset.create({ data: { id: sourceAssetId, worldId: sourceId, title: "Map art", originalName: "map.png", mimeType: "image/webp", byteSize: image.data.length, width: image.width, height: image.height, sha256: image.sha256, archived: true } });
  await db.world.update({ where: { id: sourceId }, data: { appearance: JSON.stringify({ logoUrl: `/api/assets/${sourceAssetId}/file` }) } });
  const block = await db.rpgBlock.create({ data: { worldId: sourceId, category: "NPC", name: "Map block", system: "DND_5E", statsJson: "{}" } });
  await db.article.update({ where: { id: parentArticle.id }, data: {
    contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "articleLink", attrs: { articleId: article.id, label: article.title } },
      { type: "campaignStatblock", attrs: { blockId: block.id } },
    ] }] }),
    contentHtml: `<p><span data-article-id="${article.id}">Map target</span><section data-statblock-id="${block.id}"></section></p>`,
    metadata: JSON.stringify({ dnd5eStatblockId: block.id }),
  } });
  const session = await db.campaignSession.create({ data: { worldId: sourceId, title: "Linked session" } });
  await db.sessionEntityLink.createMany({ data: [
    { worldId: sourceId, sessionId: session.id, kind: "article", entityId: article.id },
    { worldId: sourceId, sessionId: session.id, kind: "statblock", entityId: block.id },
    { worldId: sourceId, sessionId: session.id, kind: "article", entityId: "missing-article" },
  ] });
  await db.audiencePolicy.createMany({ data: [
    { worldId: sourceId, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC" },
    { worldId: sourceId, resourceKind: "statblocks", resourceId: block.id, mode: "PUBLIC" },
  ] });
  const map = await db.map.create({ data: { worldId: sourceId, title: "Map", imageUrl: `/api/assets/${sourceAssetId}/file`, layers: { create: { name: "Terrain", imageUrl: `/api/assets/${sourceAssetId}/file` } }, markerGroups: { create: { name: "Places" } } }, include: { layers: true, markerGroups: true } });
  await db.marker.create({ data: { mapId: map.id, layerId: map.layers[0].id, groupId: map.markerGroups[0].id, title: "Village", x: 25, y: 50, articleId: article.id } });
  await db.mapElement.create({ data: { mapId: map.id, layerId: map.layers[0].id, kind: "LABEL", geometry: JSON.stringify({ x: 10, y: 20, text: "Keep" }), style: JSON.stringify({ color: "#eab308" }) } });
  const otherMap = await db.map.create({ data: { worldId: sourceId, title: "Other map", imageUrl: "https://example.invalid/other.webp", markers: { create: { layerId: map.layers[0].id, title: "Cross-map pin", x: 20, y: 20 } } } });
  assert.ok(otherMap.id);

  const bundle = await exportService.exportWorldV2(sourceId);
  assert.equal(bundle.articles.find(item => item.id === parentArticle.id)?.sidebarJson, JSON.stringify({ summary: "Quick fact retained" }));
  assert.equal(bundle.articleRevisions?.length, 1);
  assert.equal(bundle.assets.find(asset => asset.id === sourceAssetId)?.archived, true);
  const foreignUserId = randomUUID();
  bundle.members.push({ id: randomUUID(), userId: foreignUserId, role: "PLAYER", status: "ACTIVE", joinedAt: new Date().toISOString(), revokedAt: null });
  bundle.audienceGrants.push({ id: randomUUID(), policyId: bundle.audiencePolicies[0].id, userId: foreignUserId, grantedAt: new Date().toISOString(), revokedAt: null });
  bundle.auditEvents.push({ id: randomUUID(), action: "test.foreign", resourceKind: "articles", resourceId: article.id, actorId: foreignUserId, beforeJson: null, afterJson: null, parentEventId: null, createdAt: new Date().toISOString() });
  bundle.categories.reverse(); bundle.articles.reverse();
  const restored = await exportService.importWorldV2(bundle, ownerId, async (slug) => !!(await db.world.findUnique({ where: { slug }, select: { id: true } })));
  assert.equal(restored.success, true);
  const newArticle = await db.article.findFirstOrThrow({ where: { worldId: restored.worldId, slug: article.slug } });
  const newBlock = await db.rpgBlock.findFirstOrThrow({ where: { worldId: restored.worldId } });
  const newSession = await db.campaignSession.findFirstOrThrow({ where: { worldId: restored.worldId } });
  const links = await db.sessionEntityLink.findMany({ where: { worldId: restored.worldId } });
  assert.equal(links.length, 2);
  assert.ok(links.some(link => link.kind === "article" && link.entityId === newArticle.id));
  assert.ok(links.some(link => link.kind === "statblock" && link.entityId === newBlock.id));
  assert.ok(restored.warnings?.some(warning => warning.includes("missing article")));
  assert.ok(restored.warnings?.some(warning => warning.includes("cross-map layer")));
  assert.ok(restored.warnings?.some(warning => warning.includes("unavailable account")));
  assert.equal(await db.worldMember.count({ where: { worldId: restored.worldId } }), 0);
  assert.equal(await db.audienceGrant.count({ where: { policy: { worldId: restored.worldId } } }), 0);
  assert.equal((await db.accessAuditEvent.findFirstOrThrow({ where: { worldId: restored.worldId, action: "test.foreign" } })).actorId, null);
  const importedArticle = await db.article.findFirstOrThrow({ where: { worldId: restored.worldId, slug: article.slug } });
  const importedChild = await db.article.findFirstOrThrow({ where: { worldId: restored.worldId, slug: childArticle.slug } });
  const importedParent = await db.article.findFirstOrThrow({ where: { worldId: restored.worldId, slug: parentArticle.slug } });
  assert.equal(importedParent.sidebarJson, JSON.stringify({ summary: "Quick fact retained" }));
  assert.equal(importedParent.version, 3);
  assert.equal(JSON.parse(importedParent.contentJson!).content[0].content[0].attrs.articleId, newArticle.id);
  assert.equal(JSON.parse(importedParent.contentJson!).content[0].content[1].attrs.blockId, newBlock.id);
  assert.equal(JSON.parse(importedParent.metadata!).dnd5eStatblockId, newBlock.id);
  assert.match(importedParent.contentHtml!, new RegExp(newArticle.id));
  assert.match(importedParent.contentHtml!, new RegExp(newBlock.id));
  assert.equal(await db.articleMention.count({ where: { sourceArticleId: importedParent.id, targetArticleId: newArticle.id } }), 1);
  const importedRevision = await db.articleRevision.findFirstOrThrow({ where: { articleId: importedParent.id } });
  assert.equal(importedRevision.title, "Earlier parent");
  assert.equal(importedRevision.userId, ownerId);
  assert.equal(JSON.parse(importedRevision.contentJson!).content[0].content[0].attrs.articleId, newArticle.id);
  assert.equal(importedChild.parentId, importedParent.id);
  const importedChildCategory = await db.category.findFirstOrThrow({ where: { worldId: restored.worldId, name: childCategory.name } });
  const importedParentCategory = await db.category.findFirstOrThrow({ where: { worldId: restored.worldId, name: parentCategory.name } });
  assert.equal(importedChildCategory.parentId, importedParentCategory.id);
  const policies = await db.audiencePolicy.findMany({ where: { worldId: restored.worldId } });
  assert.ok(policies.some(policy => policy.resourceKind === "articles" && policy.resourceId === importedArticle.id));
  assert.ok(policies.some(policy => policy.resourceKind === "statblocks" && policy.resourceId === newBlock.id));
  const newMap = await db.map.findFirstOrThrow({ where: { worldId: restored.worldId, title: "Map" }, include: { layers: true, markerGroups: true, markers: true, elements: true } });
  assert.notEqual(newMap.id, map.id);
  assert.equal(newMap.layers.length, 1);
  assert.equal(newMap.markers[0].layerId, newMap.layers[0].id);
  assert.equal(newMap.markers[0].groupId, newMap.markerGroups[0].id);
  assert.equal(newMap.markers[0].articleId, newArticle.id);
  assert.equal(newMap.elements.length, 1);
  assert.equal(newMap.elements[0].kind, "LABEL");
  assert.equal(newMap.elements[0].layerId, newMap.layers[0].id);
  assert.match(newMap.elements[0].geometry, /Keep/);
  assert.match(newMap.imageUrl, /^\/api\/assets\//);
  assert.notEqual(newMap.imageUrl, map.imageUrl);
  assert.equal(newMap.layers[0].imageUrl, newMap.imageUrl);
  const restoredAssetId = newMap.imageUrl.split("/")[3];
  const restoredAsset = await db.imageAsset.findFirstOrThrow({ where: { id: restoredAssetId, worldId: restored.worldId } });
  assert.equal(restoredAsset.byteSize, image.data.length);
  assert.equal(restoredAsset.archived, true);
  const appearance = JSON.parse((await db.world.findUniqueOrThrow({ where: { id: restored.worldId } })).appearance!);
  assert.equal(appearance.logoUrl, newMap.imageUrl);
  const restoredOtherMap = await db.map.findFirstOrThrow({ where: { worldId: restored.worldId, title: "Other map" }, include: { markers: true } });
  assert.equal(restoredOtherMap.markers[0].layerId, null);
  assert.notEqual(newSession.id, session.id);
});

test("older v2 bundles without maps still import", async () => {
  const bundle = await exportService.exportWorldV2(sourceId);
  delete (bundle as Partial<typeof bundle>).maps;
  const restored = await exportService.importWorldV2(bundle, ownerId, async (slug) => !!(await db.world.findUnique({ where: { slug }, select: { id: true } })));
  assert.equal(restored.success, true);
  assert.equal(await db.map.count({ where: { worldId: restored.worldId } }), 0);
});
