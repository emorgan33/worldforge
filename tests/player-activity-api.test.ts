import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { SESSION_COOKIE } from "../src/lib/auth-constants";
import { hashPassword } from "../src/lib/passwords";

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
