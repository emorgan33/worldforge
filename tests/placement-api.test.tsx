import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("placement descriptions persist, clone, restore and validate", { skip: !origin }, async context => {
  assert.match(origin!, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  const db = new PrismaClient();
  const user = await db.user.create({ data: { name: "Placement test fixture", email: `placement-${Date.now()}@example.invalid` } });
  context.after(async () => { await db.world.deleteMany({ where: { ownerId: user.id } }); await deleteTestUsers(db, user.id); await db.$disconnect(); });
  const authenticatedFetch = await authorFetch(db, user.id, origin!);
  const world = await db.world.create({ data: { ownerId: user.id, title: "Placement world", slug: `placement-${Date.now()}` } });
  const assetId = randomUUID();
  await db.imageAsset.create({ data: { id: assetId, worldId: world.id, title: "Cover", originalName: "cover.webp", mimeType: "image/webp", byteSize: 1, width: 100, height: 100, sha256: `placement-${assetId}` } });
  const assetUrl = `/api/assets/${assetId}/file`;

  // World cover/banner descriptions round-trip and reject over-long text.
  const worldPatch = (body: object) => authenticatedFetch(`${origin}/api/worlds`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: world.id, title: world.title, description: "", coverImage: assetUrl, bannerImage: "", ...body }) });
  assert.equal((await worldPatch({ coverImageAlt: "A weathered world map" })).status, 200);
  assert.equal((await worldPatch({ bannerImageAlt: "" })).status, 200);
  assert.equal((await worldPatch({ coverImageAlt: "x".repeat(301) })).status, 400);
  const storedWorld = await db.world.findUniqueOrThrow({ where: { id: world.id } });
  assert.equal(storedWorld.coverImageAlt, "A weathered world map");
  assert.equal(storedWorld.bannerImageAlt, "");

  // Article cover + portrait descriptions persist and are captured in history.
  const create = await authenticatedFetch(`${origin}/api/articles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, title: "Keep", coverImage: assetUrl, coverImageAlt: "A keep at dawn", portraitImage: assetUrl, portraitImageAlt: "The castellan", contentHtml: "<p>Lore</p>", metadata: { rulesSystem: "DND_5E" }, state: "DRAFT" }) });
  assert.equal(create.status, 201);
  const article = await create.json();
  assert.equal(article.coverImageAlt, "A keep at dawn");
  assert.equal(article.portraitImageAlt, "The castellan");
  assert.equal((await authenticatedFetch(`${origin}/api/articles/${article.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverImageAlt: "A keep at night", portraitImageAlt: "" }) })).status, 200);
  const updated = await db.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(updated.coverImageAlt, "A keep at night");
  assert.equal(updated.portraitImageAlt, "");
  assert.equal((await authenticatedFetch(`${origin}/api/articles/${article.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverImageAlt: "x".repeat(301) }) })).status, 400);

  // Cloning preserves placement images and their descriptions.
  const cloned = await authenticatedFetch(`${origin}/api/articles/${article.id}/clone`, { method: "POST" });
  assert.equal(cloned.status, 201);
  const clone = await cloned.json();
  assert.equal(clone.coverImageAlt, "A keep at night");
  assert.equal(clone.portraitImageAlt, "");
  assert.equal(clone.coverImage, assetUrl);

  // Restoring an earlier revision restores its placement snapshot.
  const revisions = await (await authenticatedFetch(`${origin}/api/articles/${article.id}/revisions`)).json();
  const original = revisions.revisions.find((revision: { coverImageAlt: string | null }) => revision.coverImageAlt === "A keep at dawn");
  assert.ok(original, "the create snapshot records the original description");
  assert.equal((await authenticatedFetch(`${origin}/api/articles/${article.id}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revisionId: original.id }) })).status, 200);
  const restored = await db.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(restored.coverImageAlt, "A keep at dawn");
  assert.equal(restored.portraitImageAlt, "The castellan");

  // A local URL remains world-scoped when represented as an absolute URL.
  const otherWorld = await db.world.create({ data: { ownerId: user.id, title: "Other placement world", slug: `placement-other-${Date.now()}` } });
  const foreignAssetId = randomUUID();
  await db.imageAsset.create({ data: { id: foreignAssetId, worldId: otherWorld.id, title: "Foreign", originalName: "foreign.webp", byteSize: 1, width: 1, height: 1, sha256: `foreign-${foreignAssetId}` } });
  const absoluteForeign = await authenticatedFetch(`${origin}/api/articles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, title: "Foreign absolute image", coverImage: `https://assets.example/api/assets/${foreignAssetId}/file` }) });
  assert.equal(absoluteForeign.status, 400);

  // String contentJson is rejected so its later JSON.stringify cannot turn a
  // validated document into a string and expose unvalidated fallback HTML.
  const stringDocumentWithForeignFallback = await authenticatedFetch(`${origin}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worldId: world.id,
      title: "String document with foreign fallback",
      contentJson: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: assetUrl } }] }),
      contentHtml: `<img src="/api/assets/${foreignAssetId}/file">`,
    }),
  });
  assert.equal(stringDocumentWithForeignFallback.status, 400);
  const stringContentPatch = await authenticatedFetch(`${origin}/api/articles/${article.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentJson: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: assetUrl } }] }),
      contentHtml: `<img src="/api/assets/${foreignAssetId}/file">`,
    }),
  });
  assert.equal(stringContentPatch.status, 400);

  // Nullable placements stay optional when cloning a plain article.
  const plainArticle = await db.article.create({ data: { worldId: world.id, title: "Plain article", slug: `plain-${Date.now()}` } });
  const plainCloneResponse = await authenticatedFetch(`${origin}/api/articles/${plainArticle.id}/clone`, { method: "POST" });
  assert.equal(plainCloneResponse.status, 201);
  const plainClone = await plainCloneResponse.json();
  assert.equal(plainClone.coverImage, null);
  assert.equal(plainClone.portraitImage, null);

  // Category illustrations must be managed world images, and can be cleared.
  const category = await db.category.create({ data: { worldId: world.id, name: "Atlas", order: 0 } });
  const sendCategory = (body: object) => authenticatedFetch(`${origin}/api/categories`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, action: "setIconImage", id: category.id, ...body }) });
  assert.equal((await sendCategory({ iconImage: "https://example.invalid/art.jpg" })).status, 400);
  assert.equal((await sendCategory({ iconImage: `/api/assets/${randomUUID()}/file` })).status, 400);
  assert.equal((await sendCategory({ iconImage: assetUrl })).status, 200);
  assert.equal((await db.category.findUniqueOrThrow({ where: { id: category.id } })).iconImage, assetUrl);
  assert.equal((await sendCategory({ iconImage: null })).status, 200);
  assert.equal((await db.category.findUniqueOrThrow({ where: { id: category.id } })).iconImage, null);
});
