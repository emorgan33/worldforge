import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { hashPassword, tokenHash } from "../src/lib/passwords";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("players save readable articles and maps privately, per account", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Bookmark owner", email: `bookmark-owner-${randomUUID()}@example.invalid` } });
  const password = "Isolated bookmark passphrase 2046!";
  const playerA = await db.user.create({ data: { name: "Bookmark A", email: `bookmark-a-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  const playerB = await db.user.create({ data: { name: "Bookmark B", email: `bookmark-b-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });

  const stamp = randomUUID();
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Bookmark world", slug: `bookmark-${stamp}` } });
  await db.worldMember.createMany({ data: [
    { worldId: world.id, userId: playerA.id, role: "PLAYER", status: "ACTIVE" },
    { worldId: world.id, userId: playerB.id, role: "PLAYER", status: "ACTIVE" },
  ] });
  const article = await db.article.create({ data: { worldId: world.id, slug: `saved-${stamp}`, title: "Saved lore" } });
  const privateArticle = await db.article.create({ data: { worldId: world.id, slug: `private-${stamp}`, title: "GM only lore" } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });

  const login = async (userId: string) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const response = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "127.0.0.1" },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(response.status, 200, await response.text());
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  const cookieA = await login(playerA.id);
  const cookieB = await login(playerB.id);
  const call = (cookie: string, method: string, body?: unknown) =>
    fetch(`${origin}/api/player/bookmarks`, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin! }, body: body === undefined ? undefined : JSON.stringify(body) });
  const list = async (cookie: string) => {
    const response = await call(cookie, "GET");
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).items as { id: string; resourceId: string; kind: string; title: string; href: string }[];
  };
  const save = (cookie: string, resourceKind: string, resourceId: string) => call(cookie, "POST", { resourceKind, resourceId });
  const unsave = (cookie: string, resourceKind: string, resourceId: string) => call(cookie, "DELETE", { resourceKind, resourceId });

  assert.deepEqual(await list(cookieA), []);
  assert.equal((await save(cookieA, "article", privateArticle.id)).status, 404, "unreadable articles cannot be saved");
  assert.equal((await save(cookieA, "article", article.id)).status, 200);
  assert.equal((await save(cookieA, "article", article.id)).status, 200, "saving twice is idempotent");
  assert.equal(await db.playerBookmark.count({ where: { userId: playerA.id, resourceId: article.id } }), 1);

  const items = await list(cookieA);
  assert.deepEqual(items.map(item => item.title), ["Saved lore"]);
  assert.equal(items[0].href, `/c/${world.slug}/a/${article.slug}`);
  assert.equal(items[0].resourceId, article.id);
  assert.deepEqual(await list(cookieB), [], "bookmarks are private per account");

  // Removing another player's bookmark does nothing to the owner's list.
  assert.equal((await unsave(cookieB, "article", article.id)).status, 200);
  assert.equal((await list(cookieA)).length, 1);
  assert.equal((await unsave(cookieA, "article", article.id)).status, 200);
  assert.deepEqual(await list(cookieA), []);

  // Renames and access changes are reflected at read time.
  await save(cookieA, "article", article.id);
  await db.article.update({ where: { id: article.id }, data: { title: "Saved lore revised" } });
  assert.equal((await list(cookieA))[0].title, "Saved lore revised");
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: article.id } }, data: { mode: "GM_ONLY" } });
  assert.deepEqual(await list(cookieA), [], "revoked access hides the bookmark");
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: article.id } }, data: { mode: "PUBLIC" } });
  assert.equal((await list(cookieA)).length, 1, "restored access shows the private bookmark again");

  // Published map bookmarks follow publication, image access and republishing.
  const existing = await db.imageAsset.findFirst({ where: { worldId: world.id } });
  const asset = existing ?? await db.imageAsset.create({
    data: { worldId: world.id, title: "Bookmark map", originalName: "map.webp", byteSize: 32, width: 1000, height: 600, sha256: stamp.replaceAll("-", "").padEnd(64, "0").slice(0, 64) },
  });
  const map = await db.map.create({ data: { worldId: world.id, title: "Working map", imageUrl: `/api/assets/${asset.id}/file`, width: 1000, height: 600 } });
  const marker = await db.marker.create({ data: { mapId: map.id, title: "Harbor", x: 30, y: 40 } });
  const owned = await authorFetch(db, owner.id, origin!);
  const publishBody = { worldId: world.id, mapId: map.id, layers: [], markers: [marker.id], elements: [], shareImages: true };
  const publish = () => owned(`${origin}/api/maps/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(publishBody) });
  assert.equal((await publish()).status, 201);
  await owned(`${origin}/api/resources/maps/${map.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PUBLIC", userIds: [] }) });

  assert.equal((await save(cookieA, "map", map.id)).status, 200);
  const mapItem = (await list(cookieA)).find(item => item.kind === "map");
  assert.ok(mapItem);
  assert.equal(mapItem.href, `/c/${world.slug}/maps/${map.id}`);

  const unpublish = await owned(`${origin}/api/maps/publish`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, mapId: map.id }) });
  assert.equal(unpublish.status, 200);
  assert.equal((await list(cookieA)).some(item => item.kind === "map"), false, "unpublished maps are hidden");
  assert.equal((await publish()).status, 201);
  assert.ok((await list(cookieA)).some(item => item.kind === "map"), "republishing restores the saved map");

  await owned(`${origin}/api/resources/assets/${asset.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "GM_ONLY", userIds: [] }) });
  assert.equal((await list(cookieA)).some(item => item.kind === "map"), false, "an unreadable map image hides the bookmark");
  assert.equal((await save(cookieA, "map", map.id)).status, 404, "a map with an unreadable image cannot be saved");
  await owned(`${origin}/api/resources/assets/${asset.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PUBLIC", userIds: [] }) });

  // Writes require a matching Origin and reject preview sessions.
  const foreign = await fetch(`${origin}/api/player/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieA, Origin: "https://evil.invalid" },
    body: JSON.stringify({ resourceKind: "article", resourceId: article.id }),
  });
  assert.equal(foreign.status, 403);
  const noOrigin = await fetch(`${origin}/api/player/bookmarks`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Cookie: cookieA },
    body: JSON.stringify({ resourceKind: "article", resourceId: article.id }),
  });
  assert.equal(noOrigin.status, 403);
  assert.equal((await list(cookieA)).length, 2, "rejected writes leave bookmarks unchanged");

  // Preview sessions cannot create or remove bookmarks.
  const previewToken = randomBytes(32).toString("base64url");
  await db.previewSession.create({ data: { tokenHash: tokenHash(previewToken), userId: playerA.id, worldId: world.id, expiresAt: new Date(Date.now() + 3_600_000), memberAtGrant: true } });
  const previewSave = await fetch(`${origin}/api/player/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `wf_preview=${previewToken}`, Origin: origin! },
    body: JSON.stringify({ resourceKind: "article", resourceId: article.id }),
  });
  assert.equal(previewSave.status, 403);
  const previewDelete = await fetch(`${origin}/api/player/bookmarks`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Cookie: `wf_preview=${previewToken}`, Origin: origin! },
    body: JSON.stringify({ resourceKind: "article", resourceId: article.id }),
  });
  assert.equal(previewDelete.status, 403);
  const previewGet = await fetch(`${origin}/api/player/bookmarks`, { headers: { Cookie: `wf_preview=${previewToken}` } });
  assert.equal(previewGet.status, 200);
  assert.deepEqual((await previewGet.json()).items, []);

  // Archived worlds and revoked membership hide saved items without deleting them.
  await db.world.update({ where: { id: world.id }, data: { deletedAt: new Date() } });
  assert.deepEqual(await list(cookieA), []);
  await db.world.update({ where: { id: world.id }, data: { deletedAt: null } });
  assert.equal((await list(cookieA)).length, 2);
  await db.worldMember.updateMany({ where: { worldId: world.id, userId: playerA.id }, data: { status: "REVOKED" } });
  assert.deepEqual(await list(cookieA), []);
  await db.worldMember.updateMany({ where: { worldId: world.id, userId: playerA.id }, data: { status: "ACTIVE" } });

  // Selected-player grants hide and restore a bookmark.
  const articlePolicy = await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: article.id } }, data: { mode: "PLAYER_SNAPSHOT" } });
  assert.equal((await list(cookieA)).some(item => item.kind === "article"), false);
  const grant = await db.audienceGrant.create({ data: { policyId: articlePolicy.id, userId: playerA.id, grantedById: owner.id } });
  assert.equal((await list(cookieA)).some(item => item.kind === "article"), true);
  await db.audienceGrant.delete({ where: { id: grant.id } });
  assert.equal((await list(cookieA)).some(item => item.kind === "article"), false, "revoking the specific grant hides the bookmark");
  await db.audienceGrant.create({ data: { policyId: articlePolicy.id, userId: playerA.id, grantedById: owner.id } });
  assert.equal((await list(cookieA)).some(item => item.kind === "article"), true, "restoring the grant shows it again");
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: article.id } }, data: { mode: "PUBLIC" } });

  // An unpublished map cannot be saved.
  const draftMap = await db.map.create({ data: { worldId: world.id, title: "Unpublished map", imageUrl: `/api/assets/${asset.id}/file`, width: 1000, height: 600 } });
  await owned(`${origin}/api/resources/maps/${draftMap.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PUBLIC", userIds: [] }) });
  assert.equal((await save(cookieA, "map", draftMap.id)).status, 404, "a map without a publication cannot be saved");

  // Hidden bookmarks do not consume the visible list limit.
  await db.playerBookmark.createMany({
    data: Array.from({ length: 105 }, () => ({ userId: playerA.id, worldId: world.id, resourceKind: "article", resourceId: randomUUID() })),
  });
  const filtered = await list(cookieA);
  assert.equal(filtered.length, 2, "only readable bookmarks count toward the list");
  assert.ok(filtered.some(item => item.resourceId === article.id));

  assert.equal((await call("", "GET")).status, 401);
  assert.match((await call("", "GET")).headers.get("cache-control") ?? "", /no-store/);

  // Deleting a resource clears its bookmark rows.
  assert.equal((await owned(`${origin}/api/articles/${article.id}`, { method: "DELETE" })).status, 200);
  const deletedMap = await owned(`${origin}/api/maps`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteMap", worldId: world.id, id: map.id }) });
  assert.equal(deletedMap.status, 200);
  assert.equal(await db.playerBookmark.count({ where: { resourceId: { in: [article.id, map.id] } } }), 0);
});
