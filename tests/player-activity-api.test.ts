import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { SESSION_COOKIE } from "../src/lib/auth-constants";
import { hashPassword, tokenHash } from "../src/lib/passwords";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("the player feed shows only currently readable shares, per player", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Feed owner", email: `feed-owner-${randomUUID()}@example.invalid` } });
  const password = "Isolated feed player passphrase 2046!";
  const playerA = await db.user.create({ data: { name: "Feed player A", email: `feed-a-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  const playerB = await db.user.create({ data: { name: "Feed player B", email: `feed-b-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });

  const stamp = randomUUID();
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Feed world", slug: `feed-${stamp}` } });
  await db.worldMember.createMany({ data: [
    { worldId: world.id, userId: playerA.id, role: "PLAYER", status: "ACTIVE" },
    { worldId: world.id, userId: playerB.id, role: "PLAYER", status: "ACTIVE" },
  ] });
  const sharedArticle = await db.article.create({ data: { worldId: world.id, slug: `shared-${stamp}`, title: "Shared lore", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const recap = await db.article.create({ data: { worldId: world.id, slug: `recap-${stamp}`, title: "Night at the harbor", template: "REPORT", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  await db.article.create({ data: { worldId: world.id, slug: `draft-${stamp}`, title: "Unshared draft" } });

  const cookieFor = async (userId: string) => {
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "127.0.0.1" },
      body: JSON.stringify({ email: (await db.user.findUniqueOrThrow({ where: { id: userId } })).email, password }),
    });
    assert.equal(login.status, 200, await login.text());
    return login.headers.get("set-cookie")!.split(";")[0];
  };
  const cookieA = await cookieFor(playerA.id);
  const cookieB = await cookieFor(playerB.id);
  const feed = async (cookie: string) => {
    const response = await fetch(`${origin}/api/player/activity`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).items as { id: string; kind: string; label: string; title: string; href: string; occurredAt: string }[];
  };

  assert.deepEqual(await feed(cookieA), [], "nothing is shared yet");

  const owned = await authorFetch(db, owner.id, origin!);
  const share = (kind: string, id: string, body: unknown, method = "PUT") =>
    owned(`${origin}/api/resources/${kind}/${id}/audience`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await share("articles", sharedArticle.id, { mode: "PUBLIC", userIds: [] })).status, 200);
  assert.equal((await share("articles", recap.id, { mode: "PUBLIC", userIds: [] })).status, 200);

  let items = await feed(cookieA);
  assert.deepEqual(items.map(item => item.title).sort(), ["Night at the harbor", "Shared lore"]);
  assert.equal(items.find(item => item.title === "Night at the harbor")?.label, "Session recap");
  assert.equal(items.find(item => item.title === "Shared lore")?.href, `/c/${world.slug}/a/${sharedArticle.slug}`);
  assert.doesNotMatch(JSON.stringify(items), /Unshared draft/, "draft titles must never appear");

  // The feed reads the current title, not a stored copy.
  await db.article.update({ where: { id: sharedArticle.id }, data: { title: "Shared lore revised" } });
  assert.ok((await feed(cookieA)).some(item => item.title === "Shared lore revised"));
  await db.article.update({ where: { id: sharedArticle.id }, data: { title: "Shared lore" } });

  // A map appears only once it has both an audience policy and a publication.
  const asset = await db.imageAsset.create({
    data: { worldId: world.id, title: "Feed map", originalName: "feed.webp", byteSize: 32, width: 1000, height: 600, sha256: stamp.replaceAll("-", "").padEnd(64, "0").slice(0, 64) },
  });
  const map = await db.map.create({ data: { worldId: world.id, title: "Working map", imageUrl: `/api/assets/${asset.id}/file`, width: 1000, height: 600 } });
  assert.equal((await share("maps", map.id, { mode: "PUBLIC", userIds: [] })).status, 200);
  assert.equal((await feed(cookieA)).some(item => item.kind === "map"), false, "an unpublished map is not new content");
  const publish = await owned(`${origin}/api/maps/publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId: world.id, mapId: map.id, layers: [], markers: [], elements: [], shareImages: true }),
  });
  assert.equal(publish.status, 400, "a publication with no selected content is rejected");

  const marker = await db.marker.create({ data: { mapId: map.id, title: "Harbor", x: 30, y: 40 } });
  const published = await owned(`${origin}/api/maps/publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId: world.id, mapId: map.id, layers: [], markers: [marker.id], elements: [], shareImages: true }),
  });
  assert.equal(published.status, 201, await published.clone().text());
  items = await feed(cookieA);
  const mapItem = items.find(item => item.kind === "map");
  assert.ok(mapItem);
  assert.equal(mapItem.href, `/c/${world.slug}/maps/${map.id}`);
  const firstOccurrence = mapItem.occurredAt;

  await new Promise(resolve => setTimeout(resolve, 1100));
  const republished = await owned(`${origin}/api/maps/publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId: world.id, mapId: map.id, layers: [], markers: [marker.id], elements: [], shareImages: true }),
  });
  assert.equal(republished.status, 201);
  const bumped = (await feed(cookieA)).find(item => item.kind === "map")!;
  assert.ok(new Date(bumped.occurredAt) > new Date(firstOccurrence), "republishing moves the map back to the top");

  // Revoking the map image hides the map instead of linking to an unavailable page.
  assert.equal((await share("assets", asset.id, { mode: "GM_ONLY", userIds: [] })).status, 200);
  assert.equal((await feed(cookieA)).some(item => item.kind === "map"), false);
  assert.equal((await share("assets", asset.id, { mode: "PUBLIC", userIds: [] })).status, 200);
  assert.ok((await feed(cookieA)).some(item => item.kind === "map"));

  // A player-specific share is invisible to another player.
  assert.equal((await share("articles", sharedArticle.id, { mode: "PLAYER_SNAPSHOT", userIds: [playerA.id] })).status, 200);
  assert.ok((await feed(cookieA)).some(item => item.title === "Shared lore"));
  assert.equal((await feed(cookieB)).some(item => item.title === "Shared lore"), false);

  // Revoking access removes the entry without deleting history elsewhere.
  assert.equal((await share("articles", sharedArticle.id, {}, "DELETE")).status, 200);
  assert.equal((await feed(cookieA)).some(item => item.title === "Shared lore"), false);

  // Unpublishing the map removes it from the feed.
  const unpublished = await owned(`${origin}/api/maps/publish`, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId: world.id, mapId: map.id }),
  });
  assert.equal(unpublished.status, 200);
  assert.equal((await feed(cookieA)).some(item => item.kind === "map"), false);

  const anonymous = await fetch(`${origin}/api/player/activity`);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("cache-control") ?? "", /no-store/);

  // Archiving the world or revoking membership hides every entry.
  await db.worldMember.updateMany({ where: { worldId: world.id, userId: playerA.id }, data: { status: "REVOKED" } });
  assert.deepEqual(await feed(cookieA), []);
  await db.worldMember.updateMany({ where: { worldId: world.id, userId: playerA.id }, data: { status: "ACTIVE" } });
  await db.world.update({ where: { id: world.id }, data: { deletedAt: new Date() } });
  assert.deepEqual(await feed(cookieA), []);
  await db.world.update({ where: { id: world.id }, data: { deletedAt: null } });

  // A preview session sees only the previewed world.
  const secondWorld = await db.world.create({ data: { ownerId: owner.id, title: "Other feed world", slug: `feed-other-${stamp}` } });
  await db.worldMember.create({ data: { worldId: secondWorld.id, userId: playerA.id, role: "PLAYER", status: "ACTIVE" } });
  const otherArticle = await db.article.create({ data: { worldId: secondWorld.id, slug: `other-${stamp}`, title: "Other world lore" } });
  await db.audiencePolicy.create({ data: { worldId: secondWorld.id, resourceKind: "articles", resourceId: otherArticle.id, mode: "PUBLIC", createdById: owner.id } });
  await db.playerActivity.create({ data: { worldId: secondWorld.id, resourceKind: "article", resourceId: otherArticle.id } });
  const previewToken = randomBytes(32).toString("base64url");
  await db.previewSession.create({ data: { tokenHash: tokenHash(previewToken), userId: playerA.id, worldId: world.id, expiresAt: new Date(Date.now() + 3_600_000), memberAtGrant: true } });
  const previewResponse = await fetch(`${origin}/api/player/activity`, { headers: { Cookie: `wf_preview=${previewToken}` } });
  assert.equal(previewResponse.status, 200);
  const previewTitles = ((await previewResponse.json()).items as { title: string }[]).map(item => item.title);
  assert.ok(previewTitles.includes("Night at the harbor"), "the previewed world's readable updates remain visible");
  assert.equal(previewTitles.includes("Other world lore"), false, "preview capability is scoped to one world");

  // Deleting the resources clears their feed rows rather than leaving orphans.
  const deletedArticle = await owned(`${origin}/api/articles/${recap.id}`, { method: "DELETE" });
  assert.equal(deletedArticle.status, 200, await deletedArticle.clone().text());
  const deletedMap = await owned(`${origin}/api/maps`, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "deleteMap", worldId: world.id, id: map.id }),
  });
  assert.equal(deletedMap.status, 200, await deletedMap.clone().text());
  assert.equal(await db.playerActivity.count({ where: { resourceId: { in: [recap.id, map.id] } } }), 0);
});

test("a player cannot read another player's feed through the session cookie", { skip: !origin }, async () => {
  // The endpoint resolves the caller from the session cookie only; there is no
  // player query parameter to spoof.
  const response = await fetch(`${origin}/api/player/activity?userId=someone-else`);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(SESSION_COOKIE);
});

test("the feed pages past inaccessible candidates and caps at 20 readable updates", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Bulk feed owner", email: `bulk-owner-${randomUUID()}@example.invalid` } });
  const password = "Isolated bulk feed passphrase 2046!";
  const playerA = await db.user.create({ data: { name: "Bulk player A", email: `bulk-a-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  const playerB = await db.user.create({ data: { name: "Bulk player B", email: `bulk-b-${randomUUID()}@example.invalid`, role: "PLAYER" } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });

  const stamp = randomUUID();
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Bulk feed world", slug: `bulk-${stamp}` } });
  await db.worldMember.createMany({ data: [
    { worldId: world.id, userId: playerA.id, role: "PLAYER", status: "ACTIVE" },
    { worldId: world.id, userId: playerB.id, role: "PLAYER", status: "ACTIVE" },
  ] });

  // One readable update older than 205 updates that only player B may read.
  const older = await db.article.create({ data: { worldId: world.id, slug: `older-${stamp}`, title: "Older shared lore" } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: older.id, mode: "PUBLIC", createdById: owner.id } });
  await db.playerActivity.create({ data: { worldId: world.id, resourceKind: "article", resourceId: older.id, occurredAt: new Date(Date.now() - 3_600_000) } });

  const base = Date.now() - 1_800_000;
  for (let index = 0; index < 205; index++) {
    const article = await db.article.create({ data: { worldId: world.id, slug: `noise-${index}-${stamp}`, title: `B player only ${index}` } });
    await db.audiencePolicy.create({
      data: {
        worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PLAYER_SNAPSHOT", createdById: owner.id,
        grants: { create: { userId: playerB.id, grantedById: owner.id } },
      },
    });
    await db.playerActivity.create({ data: { worldId: world.id, resourceKind: "article", resourceId: article.id, occurredAt: new Date(base + index * 1000) } });
  }

  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "127.0.0.1" },
    body: JSON.stringify({ email: (await db.user.findUniqueOrThrow({ where: { id: playerA.id } })).email, password }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const feed = async () => {
    const response = await fetch(`${origin}/api/player/activity`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).items as { title: string; occurredAt: string }[];
  };

  assert.deepEqual((await feed()).map(item => item.title), ["Older shared lore"], "accessible updates older than the inaccessible burst must still appear");

  // 25 newer readable updates: the feed returns the newest 20.
  const newest = Date.now();
  for (let index = 0; index < 25; index++) {
    const article = await db.article.create({ data: { worldId: world.id, slug: `new-${index}-${stamp}`, title: `Bulk readable ${index}` } });
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });
    await db.playerActivity.create({ data: { worldId: world.id, resourceKind: "article", resourceId: article.id, occurredAt: new Date(newest + index * 1000) } });
  }
  const capped = await feed();
  assert.equal(capped.length, 20);
  assert.equal(capped[0].title, "Bulk readable 24");
  assert.equal(capped[19].title, "Bulk readable 5");
});
