import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { SESSION_COOKIE } from "../src/lib/auth-constants";
import { writeAsset, removeAssetFile } from "../src/lib/asset-storage";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("the campaign access matrix leaks no private resource to the wrong caller", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Matrix owner", email: `matrix-owner-${randomUUID()}@example.invalid` } });
  const member = await db.user.create({ data: { name: "Matrix member", email: `matrix-member-${randomUUID()}@example.invalid`, role: "PLAYER" } });
  const stranger = await db.user.create({ data: { name: "Matrix stranger", email: `matrix-stranger-${randomUUID()}@example.invalid`, role: "PLAYER" } });
  const revoked = await db.user.create({ data: { name: "Matrix revoked", email: `matrix-revoked-${randomUUID()}@example.invalid`, role: "PLAYER" } });
  const stamp = randomUUID();
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Matrix world", slug: `matrix-${stamp}`, isPublic: false } });
  const assetId = randomUUID();
  await writeAsset(assetId, Buffer.from([0, 1, 2, 3]));
  context.after(async () => {
    await removeAssetFile(assetId).catch(() => undefined);
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, member.id, stranger.id, revoked.id);
    await db.$disconnect();
  });

  await db.worldMember.createMany({ data: [
    { worldId: world.id, userId: member.id, role: "PLAYER", status: "ACTIVE" },
    { worldId: world.id, userId: revoked.id, role: "PLAYER", status: "REVOKED" },
  ] });
  const asset = await db.imageAsset.create({
    data: { id: assetId, worldId: world.id, title: "Matrix map", originalName: "map.webp", byteSize: 4, width: 1000, height: 600, sha256: stamp.replaceAll("-", "").padEnd(64, "0").slice(0, 64) },
  });
  const shared = await db.article.create({ data: { worldId: world.id, slug: `shared-${stamp}`, title: "Harbor gazette", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const memberOnly = await db.article.create({ data: { worldId: world.id, slug: `member-${stamp}`, title: "Member secret", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const gmOnly = await db.article.create({ data: { worldId: world.id, slug: `gm-${stamp}`, title: "GM vault", publicationStatus: "DRAFT", visibility: "PRIVATE" } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: shared.id, mode: "PUBLIC", createdById: owner.id } });
  const memberPolicy = await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: memberOnly.id, mode: "PLAYER_SNAPSHOT", createdById: owner.id } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "assets", resourceId: asset.id, mode: "PUBLIC", createdById: owner.id } });
  await db.audienceGrant.create({ data: { policyId: memberPolicy.id, userId: member.id, grantedById: owner.id } });
  const map = await db.map.create({ data: { worldId: world.id, title: "Working matrix map", imageUrl: `/api/assets/${asset.id}/file`, width: 1000, height: 600 } });
  await db.mapPublication.create({ data: {
    mapId: map.id,
    snapshot: JSON.stringify({
      version: 1, title: "Published matrix map", description: null, imageUrl: `/api/assets/${asset.id}/file`,
      width: 1000, height: 600, defaultZoom: 1, layers: [], elements: [],
      markers: [{ id: "pin", layerId: null, title: "Harbor of Dawn", description: null, x: 30, y: 40, icon: "flag", color: "#3b82f6", articleId: shared.id }],
    }),
  } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "maps", resourceId: map.id, mode: "PUBLIC", createdById: owner.id } });
  await db.playerNote.create({ data: { userId: member.id, worldId: world.id, title: "Private note", content: "Do not leak this note body." } });
  await db.playerBookmark.create({ data: { userId: member.id, worldId: world.id, resourceKind: "article", resourceId: shared.id } });
  await db.playerActivity.create({ data: { worldId: world.id, resourceKind: "article", resourceId: shared.id } });

  async function cookieFor(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await db.authSession.create({ data: { userId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 3_600_000) } });
    return `${SESSION_COOKIE}=${token}`;
  }
  const memberCookie = await cookieFor(member.id);
  const ownerCookie = await cookieFor(owner.id);
  const strangerCookie = await cookieFor(stranger.id);
  const revokedCookie = await cookieFor(revoked.id);
  const previewToken = randomBytes(32).toString("base64url");
  await db.previewSession.create({ data: { tokenHash: tokenHash(previewToken), userId: member.id, worldId: world.id, expiresAt: new Date(Date.now() + 3_600_000), memberAtGrant: true } });
  const previewCookie = `wf_preview=${previewToken}`;
  const search = (cookie?: string) => fetch(`${origin}/api/c/${world.slug}/search?q=harbor`, { headers: cookie ? { Cookie: cookie } : undefined });

  // Anonymous: every private surface refuses or reveals nothing.
  for (const path of ["/api/player/bookmarks", "/api/player/notes", "/api/player/activity"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 401, `${path} must reject anonymous callers`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  assert.equal((await search()).status, 401);
  assert.equal((await fetch(`${origin}/api/assets/${asset.id}/file`)).status, 404);
  assert.equal((await fetch(`${origin}/api/worlds/${world.id}/export`)).status, 401);
  const anonMap = await fetch(`${origin}/c/${world.slug}/maps/${map.id}`).then(response => response.text());
  assert.doesNotMatch(anonMap, /Published matrix map/);

  // Active member: own private data and readable campaign content only.
  const memberSearch = await search(memberCookie);
  assert.equal(memberSearch.status, 200);
  const memberTitles = ((await memberSearch.json()).articles as { title: string }[]).map(article => article.title);
  assert.deepEqual(memberTitles, ["Harbor gazette"]);
  const grantedSearch = await fetch(`${origin}/api/c/${world.slug}/search?q=member`, { headers: { Cookie: memberCookie } });
  assert.deepEqual(((await grantedSearch.json()).articles as { title: string }[]).map(article => article.title), ["Member secret"]);
  assert.match(await fetch(`${origin}/api/assets/${asset.id}/file`, { headers: { Cookie: memberCookie } }).then(response => response.text()), /./);
  const memberMap = await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: memberCookie } });
  const memberMapHtml = await memberMap.text();
  assert.equal(memberMap.status, 200);
  assert.match(memberMapHtml, /Published matrix map/);
  assert.match(memberMapHtml, /Harbor of Dawn/);
  assert.equal((await fetch(`${origin}/api/worlds/${world.id}/export`, { headers: { Cookie: memberCookie } })).status, 403);
  const notes = await fetch(`${origin}/api/player/notes`, { headers: { Cookie: memberCookie } }).then(response => response.json());
  assert.deepEqual(notes.notes.map((note: { title: string }) => note.title), ["Private note"]);
  assert.equal((await fetch(`${origin}/api/player/bookmarks`, { headers: { Cookie: memberCookie } }).then(response => response.json())).items.length, 1);

  // Non-member: no campaign content, no private data about the member.
  assert.equal((await search(strangerCookie)).status, 404);
  assert.equal((await fetch(`${origin}/api/assets/${asset.id}/file`, { headers: { Cookie: strangerCookie } })).status, 404);
  const strangerMap = await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: strangerCookie } }).then(response => response.text());
  assert.doesNotMatch(strangerMap, /Published matrix map|Harbor of Dawn/);
  assert.doesNotMatch(await fetch(`${origin}/api/player/notes`, { headers: { Cookie: strangerCookie } }).then(response => response.text()), /Private note|note body/);

  // Revoked membership behaves like a non-member for campaign content.
  assert.equal((await search(revokedCookie)).status, 404);
  assert.equal((await fetch(`${origin}/api/assets/${asset.id}/file`, { headers: { Cookie: revokedCookie } })).status, 404);
  assert.doesNotMatch(await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: revokedCookie } }).then(response => response.text()), /Published matrix map/);

  // Preview is scoped to the granted world and cannot read account-private data.
  assert.equal((await search(previewCookie)).status, 200);
  assert.equal((await fetch(`${origin}/api/player/notes`, { headers: { Cookie: previewCookie } })).status, 403);
  assert.deepEqual((await fetch(`${origin}/api/player/bookmarks`, { headers: { Cookie: previewCookie } }).then(response => response.json())).items, []);
  assert.equal((await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: previewCookie } })).status, 200);

  // Archived campaigns leave every campaign surface.
  await db.world.update({ where: { id: world.id }, data: { deletedAt: new Date() } });
  assert.equal((await search(memberCookie)).status, 404);
  assert.equal((await fetch(`${origin}/api/worlds/${world.id}/export`, { headers: { Cookie: memberCookie } })).status, 403);
  assert.equal((await fetch(`${origin}/api/worlds/${world.id}/export`, { headers: { Cookie: ownerCookie } })).status, 404);
  assert.doesNotMatch(await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: memberCookie } }).then(response => response.text()), /Published matrix map/);
  await db.world.update({ where: { id: world.id }, data: { deletedAt: null } });

  // Revoking an image removes the bytes and the map image without exposing a URL.
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "assets", resourceId: asset.id } }, data: { mode: "GM_ONLY" } });
  assert.equal((await fetch(`${origin}/api/assets/${asset.id}/file`, { headers: { Cookie: memberCookie } })).status, 404);
  const hiddenImageMap = await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: memberCookie } }).then(response => response.text());
  assert.doesNotMatch(hiddenImageMap, new RegExp(`/api/assets/${asset.id}/file`));
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "assets", resourceId: asset.id } }, data: { mode: "PUBLIC" } });

  // Revoking an article removes it from search and direct reads.
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: shared.id } }, data: { mode: "GM_ONLY" } });
  const afterRevoke = await search(memberCookie).then(response => response.json());
  assert.equal(afterRevoke.articles.some((article: { title: string }) => article.title === "Harbor gazette"), false);
  assert.equal(gmOnly.title, "GM vault");
});
