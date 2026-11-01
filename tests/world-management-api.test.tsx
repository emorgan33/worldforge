import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("authenticated lifecycle API archives privately, restores, duplicates with retries, and purges only archived worlds", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Lifecycle API owner", email: `world-life-${randomUUID()}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "API Realm", slug: `api-realm-${randomUUID()}`, description: "Keep this", system: "PF_2E", isPublic: true } });
  const article = await db.article.create({ data: { worldId: world.id, title: "Published", slug: "published", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const assetId = randomUUID();
  await db.imageAsset.create({ data: { id: assetId, worldId: world.id, title: "Asset", originalName: "asset.webp", byteSize: 1, width: 1, height: 1, sha256: randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64) } });
  context.after(async () => { await deleteTestUsers(db, owner.id); await db.$disconnect(); });
  const owned = await authorFetch(db, owner.id, origin!);
  const request = (url: string, init?: RequestInit) => owned(`${origin}${url}`, init);
  const post = (url: string, body: unknown) => request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const duplicateRequestId = randomUUID();
  const duplicateResponse = await post(`/api/worlds/${world.id}/duplicate`, { requestId: duplicateRequestId });
  assert.equal(duplicateResponse.status, 201);
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicate.title, "API Realm (settings copy)");
  assert.equal(duplicate.system, "PF_2E");
  assert.equal(duplicate.isPublic, false);
  assert.equal(duplicate.coverImage, null);
  assert.equal(duplicate.appearance, null);
  assert.equal((await db.article.count({ where: { worldId: duplicate.id } })), 0);
  const retry = await post(`/api/worlds/${world.id}/duplicate`, { requestId: duplicateRequestId });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, duplicate.id);
  assert.equal((await post(`/api/worlds/${world.id}/duplicate`, { requestId: duplicateRequestId, title: "caller title" })).status, 400);

  assert.equal((await request(`/api/articles/${article.id}`)).status, 200);
  const archive = await request(`/api/worlds/${world.id}`, { method: "DELETE" });
  assert.equal(archive.status, 200);
  const archived = await db.world.findUniqueOrThrow({ where: { id: world.id } });
  assert.ok(archived.deletedAt);
  assert.equal(archived.isPublic, false);
  assert.equal(archived.title, "API Realm");
  assert.equal(archived.description, "Keep this");
  assert.equal((await (await request("/api/worlds")).json()).some((item: { id: string }) => item.id === world.id), false);
  assert.equal((await (await request("/api/worlds/deleted")).json()).worlds.some((item: { id: string }) => item.id === world.id), true);
  assert.equal((await request(`/api/worlds/${world.id}/sessions`)).status, 404);
  assert.equal((await request(`/api/articles/${article.id}`)).status, 404);
  assert.equal((await request(`/api/assets/${assetId}/file`)).status, 404);
  assert.equal((await fetch(`${origin}/api/articles/${article.id}`)).status, 401);
  const archivedPage = await fetch(`${origin}/w/${world.slug}`);
  const archivedHtml = await archivedPage.text();
  // The reader streams a Suspense shell before notFound(), so Next may have
  // already sent a 200 status; the archived world must never render its data.
  assert.doesNotMatch(archivedHtml, /API Realm|Keep this|Published/);
  assert.match(archivedHtml, /404|not found|could not be found/i);

  assert.equal((await post(`/api/worlds/${world.id}/restore`, {})).status, 200);
  const restored = await db.world.findUniqueOrThrow({ where: { id: world.id } });
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.isPublic, false);
  assert.equal((await request(`/api/worlds/${world.id}/sessions`)).status, 200);
  assert.equal((await request(`/api/articles/${article.id}`)).status, 200);
  assert.equal((await post(`/api/worlds/${world.id}/purge`, {})).status, 404);

  assert.equal((await request(`/api/worlds/${world.id}`, { method: "DELETE" })).status, 200);
  const purge = await post(`/api/worlds/${world.id}/purge`, {});
  assert.equal(purge.status, 200);
  assert.equal(await db.world.findUnique({ where: { id: world.id } }), null);
});
