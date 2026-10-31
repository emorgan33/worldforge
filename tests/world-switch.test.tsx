import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

// Two-world fixture with differing rules profiles and distinct records in
// every dataset, so cross-world mixing is detectable.
test("switching worlds loads only the destination world data", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Switch fixture", email: `switch-${randomUUID()}@example.invalid` } });
  context.after(async () => { await deleteTestUsers(db, owner.id); await db.$disconnect(); });
  const worldA = await db.world.create({ data: { ownerId: owner.id, title: "Ashen Coast", slug: `ashen-${randomUUID()}`, system: "PF_2E" } });
  const worldB = await db.world.create({ data: { ownerId: owner.id, title: "Ashen Coast", slug: `ashen-${randomUUID()}`, system: "DND_5E" } });
  const seed = async (worldId: string, tag: string) => {
    const article = await db.article.create({ data: { worldId, slug: `${tag}-article-${randomUUID()}`, title: `${tag} article` } });
    const collection = await db.variableCollection.create({ data: { worldId, name: `${tag} vars`, prefix: tag.toLowerCase() } });
    await db.variable.create({ data: { collectionId: collection.id, key: "k", value: tag } });
    await db.map.create({ data: { worldId, title: `${tag} map`, imageUrl: "https://example.invalid/map.png" } });
    const timeline = await db.timeline.create({ data: { worldId, title: `${tag} timeline` } });
    await db.era.create({ data: { timelineId: timeline.id, name: `${tag} era`, startYear: 1, order: 0 } });
    await db.secret.create({ data: { worldId, articleId: article.id, title: `${tag} secret`, content: tag } });
    await db.rpgBlock.create({ data: { worldId, name: `${tag} block`, system: tag === "AAA" ? "PF_2E" : "DND_5E", category: "MONSTER", statsJson: "{}" } });
    await db.campaignSession.create({ data: { worldId, title: `${tag} session` } });
    return article;
  };
  const articleA = await seed(worldA.id, "AAA");
  const articleB = await seed(worldB.id, "BBB");
  const owned = await authorFetch(db, owner.id, origin!);

  const list = async (path: string, worldId: string) => (await (await owned(`${origin}/api/${path}?worldId=${worldId}`)).json()) as Record<string, unknown>[];
  for (const path of ["articles", "variables", "maps", "timelines", "secrets", "statblocks"]) {
    const [a, b] = await Promise.all([list(path, worldA.id), list(path, worldB.id)]);
    assert.equal(a.length >= 1 && b.length >= 1, true, path);
    // Every record served for a world query must belong to (or name) that world;
    // a record tagged "B" must never appear in world A's payload and vice versa.
    for (const item of a) assert.equal(JSON.stringify(item).includes('"BBB'), false, `${path} A-mix`);
    for (const item of b) assert.equal(JSON.stringify(item).includes('"AAA'), false, `${path} B-mix`);
  }
  const sessionsA = await (await owned(`${origin}/api/worlds/${worldA.id}/sessions`)).json();
  const sessionsB = await (await owned(`${origin}/api/worlds/${worldB.id}/sessions`)).json();
  assert.equal(sessionsA[0].title, "AAA session");
  assert.equal(sessionsB[0].title, "BBB session");
  // Duplicate titles stay distinct; article detail never crosses worlds.
  const worlds = (await (await owned(`${origin}/api/worlds`)).json()) as { id: string; title: string; slug: string; system: string }[];
  assert.deepEqual(worlds.filter(world => world.title === "Ashen Coast").map(world => world.slug).length, 2);
  assert.equal((await (await owned(`${origin}/api/articles/${articleA.id}`)).json()).worldId, worldA.id);
  assert.equal((await (await owned(`${origin}/api/articles/${articleB.id}`)).json()).worldId, worldB.id);
});
