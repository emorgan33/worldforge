import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();
test("owner search finds body text, paginates, filters, and hides other campaigns", { skip: !origin }, async context => {
  assert.match(origin!, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Search fixture", email: `search-${stamp}@example.invalid` } });
  const outsider = await db.user.create({ data: { name: "Other search author", email: `search-out-${stamp}@example.invalid` } });
  context.after(async () => { await db.user.deleteMany({ where: { id: { in: [owner.id, outsider.id] } } }); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Search world", slug: `search-${stamp}` } });
  const other = await db.world.create({ data: { ownerId: outsider.id, title: "Foreign search", slug: `search-out-${stamp}` } });
  const owned = await authorFetch(db, owner.id, origin!);
  const foreign = await authorFetch(db, outsider.id, origin!);
  const parent = await db.category.create({ data: { worldId: world.id, name: "Atlas", order: 0 } });
  const child = await db.category.create({ data: { worldId: world.id, name: "Cities", parentId: parent.id, order: 0 } });
  const bodyToken = `WF_BODY_${stamp}`;
  const titleToken = `WF_TITLE_${stamp}`;
  await db.article.create({ data: { worldId: world.id, slug: `body-${stamp}`, title: "Unrelated fixture title", contentHtml: `<p>Hidden ${bodyToken} phrase</p>`, categoryId: child.id, template: "LANDMARK", publicationStatus: "DRAFT" } });
  await db.article.create({ data: { worldId: world.id, slug: `spell-${stamp}`, title: `${titleToken} ward`, template: "SPELL", publicationStatus: "PUBLISHED" } });
  await db.article.create({ data: { worldId: world.id, slug: `char-${stamp}`, title: `${titleToken} envoy`, template: "CHARACTER", publicationStatus: "WIP" } });
  await db.article.create({ data: { worldId: other.id, slug: `foreign-${stamp}`, title: `${titleToken} stolen`, contentHtml: bodyToken, template: "SPELL", publicationStatus: "PUBLISHED" } });
  await db.article.createMany({ data: Array.from({ length: 42 }, (_, index) => ({ worldId: world.id, slug: `page-${stamp}-${index}`, title: `SearchPage ${String(index).padStart(2, "0")}`, template: "GENERIC", publicationStatus: "PUBLISHED" })) });

  const search = (query: string) => owned(`${origin}/api/search?${query}`);
  assert.equal((await fetch(`${origin}/api/search?worldId=${world.id}`)).status, 401);
  assert.equal((await foreign(`${origin}/api/search?worldId=${world.id}&q=${bodyToken}`)).status, 404);

  const bodyHits = await (await search(`worldId=${world.id}&q=${bodyToken}`)).json();
  assert.equal(bodyHits.articles.length, 1);
  assert.equal(bodyHits.articles[0].categoryPath, "Atlas / Cities");
  assert.equal(JSON.stringify(bodyHits).includes(bodyToken), false);

  const spells = await (await search(`worldId=${world.id}&q=${titleToken}&template=SPELL`)).json();
  assert.deepEqual(spells.articles.map((article: { title: string }) => article.title), [`${titleToken} ward`]);
  const drafts = await (await search(`worldId=${world.id}&q=${encodeURIComponent("Unrelated fixture")}&status=DRAFT`)).json();
  assert.equal(drafts.articles.length, 1);
  const nested = await (await search(`worldId=${world.id}&categoryId=${child.id}`)).json();
  assert.equal(nested.articles[0].categoryPath, "Atlas / Cities");

  const firstPage = await (await search(`worldId=${world.id}&q=SearchPage`)).json();
  assert.equal(firstPage.articles.length, 40);
  assert(firstPage.nextCursor);
  const secondPage = await (await search(`worldId=${world.id}&q=SearchPage&cursor=${firstPage.nextCursor}`)).json();
  assert.equal(secondPage.articles.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.articles, ...secondPage.articles].map((article: { id: string }) => article.id)).size, 42);
  assert.equal((await search(`worldId=${world.id}&template=NOPE`)).status, 400);
});
