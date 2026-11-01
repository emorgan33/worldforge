import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("article saves reject stale versions without changing content, revisions or mentions", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Save fixture", email: `article-save-${randomUUID()}@example.invalid` } });
  context.after(async () => { await deleteTestUsers(db, owner.id); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Save versions", slug: randomUUID() } });
  const owned = await authorFetch(db, owner.id, origin!);
  const send = (path: string, body: object, method = "PATCH") => owned(`${origin}/api/articles${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const created = await send("", { worldId: world.id, title: "Original", contentHtml: "<p>Original lore</p>" }, "POST");
  assert.equal(created.status, 201);
  const article = await created.json();
  assert.equal(article.version, 1);
  const target = await db.article.create({ data: { worldId: world.id, title: "Target", slug: randomUUID() } });
  const html = `<p><span data-article-id="${target.id}">Target</span></p>`;
  const results = await Promise.all([
    send(`/${article.id}`, { expectedVersion: 1, title: "Editor A", contentHtml: html }),
    send(`/${article.id}`, { expectedVersion: 1, title: "Editor B", contentHtml: html }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = await results.find(result => result.status === 200)!.json();
  const conflict = await results.find(result => result.status === 409)!.json();
  assert.equal(winner.version, 2);
  assert.equal(conflict.code, "ARTICLE_CONFLICT");
  assert.equal(conflict.currentVersion, 2);
  assert.equal((await db.article.findUniqueOrThrow({ where: { id: article.id } })).title, winner.title);
  const revisions = () => db.articleRevision.count({ where: { articleId: article.id } });
  const mentions = () => db.articleMention.findMany({ where: { sourceArticleId: article.id } });
  assert.equal(await revisions(), 2, "only the successful save adds a snapshot");
  assert.deepEqual((await mentions()).map(mention => mention.targetArticleId), [target.id]);
  assert.equal((await send(`/${article.id}`, { expectedVersion: 1, title: "Stale", contentHtml: "<p>No links</p>" })).status, 409);
  assert.equal(await revisions(), 2);
  assert.equal((await mentions()).length, 1);
  for (const expectedVersion of [null, 0, -1, 1.5, "2", {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await send(`/${article.id}`, { expectedVersion, title: "Invalid" })).status, 400);
  }
  assert.equal((await send(`/${article.id}`, { expectedVersion: 2, coverImage: "/not-an-asset" })).status, 400);
  for (const invalidImage of [null, 42, {}, []]) {
    assert.equal((await send(`/${article.id}`, { expectedVersion: 2, coverImage: invalidImage })).status, 400);
    assert.equal((await send(`/${article.id}`, { expectedVersion: 2, portraitImage: invalidImage })).status, 400);
  }
  assert.equal(await revisions(), 2, "invalid image values do not write revisions");
  assert.equal((await db.article.findUniqueOrThrow({ where: { id: article.id } })).version, 2, "validation failure rolls back the version increment");
  assert.equal(await revisions(), 2);
  const next = await send(`/${article.id}`, { expectedVersion: 2, title: "Next save" });
  assert.equal(next.status, 200);
  assert.equal((await next.json()).version, 3);
  const legacy = await send(`/${article.id}`, { excerpt: "Legacy API client" });
  assert.equal(legacy.status, 200, "versionless external callers retain documented compatibility");
  assert.equal((await legacy.json()).version, 4);
  const revision = await db.articleRevision.findFirstOrThrow({ where: { articleId: article.id, articleVersionAtSave: 1 } });
  assert.equal((await send(`/${article.id}/revisions`, { revisionId: revision.id }, "POST")).status, 200);
  assert.equal((await db.article.findUniqueOrThrow({ where: { id: article.id } })).version, 5, "restoring never reuses a previous concurrency token");
  assert.equal((await send(`/${article.id}`, { expectedVersion: 1, title: "Editor from before restore" })).status, 409);
});

test("article metadata rejects non-string reference values on create and update", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Metadata validation fixture", email: `metadata-validation-${randomUUID()}@example.invalid` } });
  context.after(async () => { await deleteTestUsers(db, owner.id); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Metadata validation", slug: randomUUID() } });
  const owned = await authorFetch(db, owner.id, origin!);
  const send = (path: string, body: object, method = "PATCH") => owned(`${origin}/api/articles${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  const metadata = { linkedLocation: "target-id", linkedEncounters: "first-id\nsecond-id", COCStatblockId: "coc-block-id", customExtension: { retained: true } };
  const created = await send("", { worldId: world.id, title: "Metadata shape", metadata }, "POST");
  assert.equal(created.status, 201);
  const article = await created.json();
  assert.deepEqual(JSON.parse(article.metadata), metadata);

  const malformed = [
    { linkedLocation: [] },
    { linkedEncounters: {} },
    { dnd5eParticipant1: { id: "block-id" } },
    { COCStatblockId: ["block-id"] },
  ];
  for (const invalidMetadata of malformed) {
    assert.equal((await send("", { worldId: world.id, title: "Invalid metadata", metadata: invalidMetadata }, "POST")).status, 400);
    assert.equal((await send(`/${article.id}`, { expectedVersion: 1, metadata: invalidMetadata })).status, 400);
  }

  const unchanged = await db.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(unchanged.version, 1);
  assert.deepEqual(JSON.parse(unchanged.metadata!), metadata);
});
