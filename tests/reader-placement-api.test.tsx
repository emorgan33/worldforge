import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";
import { writeAsset, removeAssetFile } from "../src/lib/asset-storage";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

function descriptions(html: string, url: string) {
  return [...html.matchAll(/<img\b[^>]*>/g)].filter(([tag]) => tag.includes(`src="${url}"`)).map(([tag]) => /alt="([^"]*)"/.exec(tag)?.[1]);
}

test("public and campaign readers preserve informative, decorative and fallback descriptions", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Placement GM", email: `placement-gm-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Placement player", email: `placement-player-${stamp}@example.invalid`, role: "PLAYER" } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "World title fallback", slug: `placement-${stamp}`, isPublic: true } });
  const ids = [randomUUID(), randomUUID()];
  const [cover, portrait] = ids.map(id => `/api/assets/${id}/file`);
  context.after(async () => {
    await db.world.deleteMany({ where: { id: world.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, player.id] } } });
    await Promise.all(ids.map(removeAssetFile));
    await db.$disconnect();
  });
  for (const id of ids) {
    await writeAsset(id, Buffer.from("placement-test-image"));
    await db.imageAsset.create({ data: { id, worldId: world.id, title: "Library metadata", alt: "Library default must not replace placement alt", originalName: "fixture.webp", sha256: id, width: 1, height: 1, byteSize: 1 } });
  }
  await db.world.update({ where: { id: world.id }, data: { coverImage: cover, coverImageAlt: "World cover description", bannerImage: cover, bannerImageAlt: "Global cover description" } });
  const article = await db.article.create({ data: { worldId: world.id, title: "Article title fallback", slug: "article", publicationStatus: "PUBLISHED", visibility: "PUBLIC", coverImage: cover, coverImageAlt: "Article cover description", portraitImage: portrait, portraitImageAlt: "Portrait description" } });
  await db.worldMember.create({ data: { worldId: world.id, userId: player.id, status: "ACTIVE" } });
  for (const [kind, id] of [["articles", article.id], ["assets", ids[0]], ["assets", ids[1]]]) {
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: kind, resourceId: id, mode: "PLAYER_SNAPSHOT", grants: { create: { userId: player.id } } } });
  }
  const playerFetch = await authorFetch(db, player.id, origin!);
  const readers = [
    { prefix: "w", request: fetch },
    { prefix: "c", request: playerFetch },
  ];
  for (const reader of readers) {
    const worldHtml = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}`)).text();
    assert(descriptions(worldHtml, cover).includes("World cover description"));
    const html = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}/a/article`)).text();
    assert(descriptions(html, cover).includes("Article cover description"));
    assert(descriptions(html, portrait).includes("Portrait description"));
  }
  await db.article.update({ where: { id: article.id }, data: { coverImageAlt: "", portraitImageAlt: null } });
  await db.world.update({ where: { id: world.id }, data: { coverImageAlt: null } });
  for (const reader of readers) {
    const html = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}/a/article`)).text();
    assert(descriptions(html, cover).includes(""));
    assert(descriptions(html, portrait).includes(article.title));
    const home = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}`)).text();
    assert(descriptions(home, cover).includes(world.title));
  }
  await db.article.update({ where: { id: article.id }, data: { coverImage: null, coverImageAlt: "Stale article description", portraitImageAlt: "" } });
  for (const reader of readers) {
    const html = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}/a/article`)).text();
    assert(descriptions(html, cover).includes("Global cover description"));
    assert(!descriptions(html, cover).includes("Stale article description"));
    assert(descriptions(html, portrait).includes(""));
  }
  await db.audienceGrant.updateMany({ where: { policy: { resourceKind: "assets", resourceId: ids[1] }, userId: player.id }, data: { revokedAt: new Date() } });
  const revoked = await (await playerFetch(`${origin}/c/${world.slug}/a/article`)).text();
  assert.equal(descriptions(revoked, portrait).length, 0);
});
