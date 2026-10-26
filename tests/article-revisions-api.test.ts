import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { PrismaClient, type Article } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

async function fixture(context: TestContext) {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Revision fixture", email: `revision-${randomUUID()}@example.invalid` } });
  context.after(async () => { await db.user.delete({ where: { id: owner.id } }); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Revision lifecycle", slug: randomUUID() } });
  const otherWorld = await db.world.create({ data: { ownerId: owner.id, title: "Other world", slug: randomUUID() } });
  const owned = await authorFetch(db, owner.id, origin!);
  const send = (id: string, action: string, body: object = {}, method = "POST") => owned(`${origin}/api/articles/${id}${action}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const target = await db.article.create({ data: { worldId: world.id, title: "Historical target", slug: randomUUID() } });
  const staleTarget = await db.article.create({ data: { worldId: world.id, title: "Current target", slug: randomUUID() } });
  const foreign = await db.article.create({ data: { worldId: otherWorld.id, title: "Foreign target", slug: randomUUID() } });
  const article = await db.article.create({ data: {
    worldId: world.id, title: "Current article", slug: randomUUID(), version: 7,
    excerpt: "Current excerpt", metadata: '{"extension":"current"}', tags: "current",
    contentHtml: `<p><span data-article-id="${staleTarget.id}">Current target</span></p>`,
    coverImage: "https://example.invalid/current.webp", coverImageAlt: "Current cover",
    portraitImage: "https://example.invalid/current-portrait.webp", portraitImageAlt: "Current portrait",
    publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT", wordCount: 2,
  } });
  await db.articleMention.create({ data: { sourceArticleId: article.id, targetArticleId: staleTarget.id, mentionText: staleTarget.title } });
  const revision = await db.articleRevision.create({ data: {
    articleId: article.id, userId: owner.id, title: "Historical article", slug: randomUUID(),
    excerpt: "Historical excerpt", metadata: '{"extension":{"legacy":true}}', tags: "historical",
    contentHtml: "<p>Three restored words</p>", contentJson: JSON.stringify(document(target.id, target.id, foreign.id, article.id)),
    coverImage: "https://example.invalid/historical.webp", coverImageAlt: "Historical cover",
    portraitImage: "https://example.invalid/historical-portrait.webp", portraitImageAlt: "",
    publicationStatus: "PUBLISHED", visibility: "PUBLIC", state: "PUBLISHED", articleVersionAtSave: 2,
  } });
  const state = () => db.article.findUniqueOrThrow({ where: { id: article.id }, include: { revisions: { orderBy: { id: "asc" } }, outboundMentions: { orderBy: { id: "asc" } } } });
  return { db, owner, world, otherWorld, owned, send, target, staleTarget, foreign, article, revision, state };
}

function document(...ids: string[]) {
  return { type: "doc", content: [{ type: "paragraph", content: ids.map(articleId => ({ type: "articleLink", attrs: { articleId, label: "Old label" } })) }] };
}

const snapshotFields = ["title", "slug", "excerpt", "contentHtml", "contentJson", "metadata", "tags", "coverImage", "coverImageAlt", "portraitImage", "portraitImageAlt", "publicationStatus", "visibility", "state"] as const;
function snapshot(article: Pick<Article, typeof snapshotFields[number]>) {
  return Object.fromEntries(snapshotFields.map(field => [field, article[field]]));
}

test("restore commits its field contract, recovery snapshot, monotonic version, word count and rebuilt backlinks", { skip: !origin }, async context => {
  const f = await fixture(context);
  const category = await f.db.category.create({ data: { worldId: f.world.id, name: "Current category" } });
  const session = await f.db.campaignSession.create({ data: { worldId: f.world.id, title: "Current reveal" } });
  const preserved = { template: "CHARACTER", categoryId: category.id, parentId: f.staleTarget.id, order: 9, isPinned: true, canonState: "ESTABLISHED", sidebarJson: '{"custom":true}', revealedInSessionId: session.id, supersededById: f.target.id };
  const current = await f.db.article.update({ where: { id: f.article.id }, data: preserved });
  const response = await f.send(f.article.id, "/revisions", { revisionId: f.revision.id });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.revision.id, f.revision.id);
  assert.equal(body.article.version, 8);
  const restored = await f.state();
  assert.deepEqual(snapshot(restored), snapshot(f.revision));
  for (const [key, value] of Object.entries(preserved)) assert.equal(restored[key as keyof Article], value, key);
  assert.equal(restored.wordCount, 3);
  assert.equal(restored.revisions.length, 2);
  const backup = restored.revisions.find(revision => revision.id !== f.revision.id)!;
  assert.deepEqual(snapshot(backup), snapshot(current));
  assert.equal(backup.articleVersionAtSave, 7);
  assert.equal(backup.userId, f.owner.id);
  assert.deepEqual(restored.outboundMentions.map(edge => [edge.targetArticleId, edge.mentionText]), [[f.target.id, f.target.title]]);
  const targetDetail = await (await f.owned(`${origin}/api/articles/${f.target.id}`)).json();
  assert.ok(targetDetail.inboundMentions.some((edge: { sourceArticleId: string }) => edge.sourceArticleId === f.article.id));
  const oldDetail = await (await f.owned(`${origin}/api/articles/${f.staleTarget.id}`)).json();
  assert.ok(!oldDetail.inboundMentions.some((edge: { sourceArticleId: string }) => edge.sourceArticleId === f.article.id));
  assert.equal((await f.send(f.article.id, "", { expectedVersion: 7, title: "Stale editor" }, "PATCH")).status, 409);

  // Older snapshots may lack placements and contain malformed JSON; HTML still supplies links.
  await f.db.articleRevision.update({ where: { id: f.revision.id }, data: {
    contentJson: "legacy malformed JSON", contentHtml: `<p>@[Historical target]</p>`,
    coverImage: null, coverImageAlt: null, portraitImage: null, portraitImageAlt: null,
  } });
  assert.equal((await f.send(f.article.id, "/revisions", { revisionId: f.revision.id })).status, 200);
  const legacy = await f.state();
  assert.equal(legacy.version, 9);
  for (const field of ["coverImage", "coverImageAlt", "portraitImage", "portraitImageAlt"] as const) assert.equal(legacy[field], null);
  assert.deepEqual(legacy.outboundMentions.map(edge => edge.targetArticleId), [f.target.id]);
  await f.db.articleRevision.update({ where: { id: f.revision.id }, data: { contentHtml: null, contentJson: null } });
  assert.equal((await f.send(f.article.id, "/revisions", { revisionId: f.revision.id })).status, 200);
  assert.equal((await f.state()).wordCount, 0);
  assert.equal((await f.state()).outboundMentions.length, 0);
});

test("restore rolls back every write on snapshot, article or mention failure", { skip: !origin }, async context => {
  const f = await fixture(context);
  const stages = [
    ['ArticleRevision', 'INSERT', `NEW.articleId = '${f.article.id}'`],
    ['Article', 'UPDATE', `NEW.id = '${f.article.id}'`],
    ['ArticleMention', 'INSERT', `NEW.sourceArticleId = '${f.article.id}'`],
  ];
  for (const [table, operation, predicate] of stages) {
    const before = await f.state();
    await f.db.$executeRawUnsafe(`CREATE TRIGGER r07_restore_failure BEFORE ${operation} ON ${table} WHEN ${predicate} BEGIN SELECT RAISE(ABORT, 'R07 injected restore failure'); END`);
    try {
      const response = await f.send(f.article.id, "/revisions", { revisionId: f.revision.id });
      assert.equal(response.status, 500, `${table}: ${await response.text()}`);
      assert.deepEqual(await f.state(), before, `${table} failure leaves the article, revisions and graph identical`);
    } finally {
      await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r07_restore_failure");
    }
  }
});

test("restore returns 409 and rolls back when its version changes before the guarded update", { skip: !origin }, async context => {
  const f = await fixture(context);
  const before = await f.state();
  // SQLite serializes writers. Inject a version change after the read to exercise the conflict rollback deterministically.
  await f.db.$executeRawUnsafe(`CREATE TRIGGER r07_restore_version AFTER INSERT ON ArticleRevision WHEN NEW.articleId = '${f.article.id}' BEGIN UPDATE Article SET version = version + 1 WHERE id = NEW.articleId; END`);
  try {
    assert.equal((await f.send(f.article.id, "/revisions", { revisionId: f.revision.id })).status, 409);
    assert.deepEqual(await f.state(), before);
  } finally {
    await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r07_restore_version");
  }
});

test("restore and clone reject invalid image placements without leaving partial data", { skip: !origin }, async context => {
  const f = await fixture(context);
  const asset = await f.db.imageAsset.create({ data: { worldId: f.otherWorld.id, title: "Foreign image", originalName: "foreign.webp", byteSize: 1, width: 1, height: 1, sha256: randomUUID() } });
  const foreignUrl = `https://example.invalid/api/assets/${asset.id}/file`;
  const invalidPlacements = [
    { coverImage: foreignUrl }, { portraitImage: foreignUrl },
    { contentJson: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: foreignUrl } }] }) },
    { contentJson: null, contentHtml: `<img src="/api/assets/${randomUUID()}/file">` },
  ];
  for (const placement of invalidPlacements) {
    await f.db.articleRevision.update({ where: { id: f.revision.id }, data: { ...snapshot(f.revision), ...placement } });
    const beforeRestore = await f.state();
    assert.equal((await f.send(f.article.id, "/revisions", { revisionId: f.revision.id })).status, 400);
    assert.deepEqual(await f.state(), beforeRestore);
    await f.db.article.update({ where: { id: f.article.id }, data: { ...snapshot(f.article), ...placement } });
    const beforeClone = await f.db.article.count({ where: { worldId: f.world.id } });
    const policies = await f.db.audiencePolicy.count({ where: { worldId: f.world.id } });
    assert.equal((await f.send(f.article.id, "/clone")).status, 400);
    assert.equal(await f.db.article.count({ where: { worldId: f.world.id } }), beforeClone);
    assert.equal(await f.db.audiencePolicy.count({ where: { worldId: f.world.id } }), policies);
  }
});

test("clone starts a private lifecycle with a fresh policy, initial revision and content-derived world-scoped mentions", { skip: !origin }, async context => {
  const f = await fixture(context);
  const session = await f.db.campaignSession.create({ data: { worldId: f.world.id, title: "Source reveal" } });
  const category = await f.db.category.create({ data: { worldId: f.world.id, name: "Source category" } });
  const source = await f.db.article.update({ where: { id: f.article.id }, data: {
    contentJson: JSON.stringify(document(f.target.id, f.target.id, f.foreign.id)),
    template: "CHARACTER", categoryId: category.id, parentId: f.staleTarget.id, order: 4, isPinned: true,
    publicationStatus: "PUBLISHED", visibility: "PUBLIC", state: "PUBLISHED", canonState: "ESTABLISHED",
    revealedInSessionId: session.id, supersededById: f.target.id,
  } });
  const policy = await f.db.audiencePolicy.create({ data: { worldId: f.world.id, resourceKind: "articles", resourceId: source.id, mode: "PLAYER_SNAPSHOT", createdById: f.owner.id } });
  await f.db.audienceGrant.create({ data: { policyId: policy.id, userId: f.owner.id, grantedById: f.owner.id } });
  const before = await f.state();
  const response = await f.send(source.id, "/clone");
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  const clone = await f.db.article.findUniqueOrThrow({ where: { id: body.id }, include: { revisions: true, outboundMentions: true } });
  assert.equal(body.version, 1);
  assert.equal(body.state, "DRAFT");
  for (const field of ["worldId", "categoryId", "template", "excerpt", "contentHtml", "contentJson", "metadata", "tags", "coverImage", "coverImageAlt", "portraitImage", "portraitImageAlt", "parentId", "order", "isPinned", "wordCount"] as const) assert.equal(clone[field], source[field], field);
  assert.equal(clone.title, `${source.title} (copy)`);
  assert.equal(clone.publicationStatus, "DRAFT");
  assert.equal(clone.visibility, "PRIVATE");
  assert.equal(clone.canonState, "GM_DRAFT");
  assert.equal(clone.revealedInSessionId, null);
  assert.equal(clone.supersededById, null);
  assert.equal(clone.revisions.length, 1);
  assert.deepEqual(snapshot(clone.revisions[0]), snapshot(clone));
  assert.equal(clone.revisions[0].articleVersionAtSave, 1);
  assert.equal(clone.revisions[0].userId, f.owner.id);
  const clonePolicy = await f.db.audiencePolicy.findUniqueOrThrow({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: clone.id } }, include: { grants: true } });
  assert.notEqual(clonePolicy.id, policy.id);
  assert.equal(clonePolicy.mode, "GM_ONLY");
  assert.equal(clonePolicy.worldId, f.world.id);
  assert.equal(clonePolicy.createdById, f.owner.id);
  assert.deepEqual(clonePolicy.grants, []);
  assert.deepEqual(clone.outboundMentions.map(edge => edge.targetArticleId), [f.target.id], "rebuild mentions instead of copying stale graph rows");
  assert.deepEqual(await f.state(), before, "clone leaves source history and graph unchanged");

  await f.db.article.update({ where: { id: source.id }, data: { coverImage: null, portraitImage: null, contentJson: null, contentHtml: "<p>@[Historical target]</p>" } });
  const legacyResponse = await f.send(source.id, "/clone");
  assert.equal(legacyResponse.status, 201);
  const legacy = await legacyResponse.json();
  assert.notEqual(legacy.slug, clone.slug);
  assert.equal(legacy.coverImage, null);
  assert.equal(legacy.portraitImage, null);
  assert.deepEqual((await f.db.articleMention.findMany({ where: { sourceArticleId: legacy.id } })).map(edge => edge.targetArticleId), [f.target.id]);
});

test("cloning a maximum-length slug keeps the world export importable", { skip: !origin }, async context => {
  const f = await fixture(context);
  const sourceSlug = "s".repeat(120);
  await f.db.article.update({ where: { id: f.article.id }, data: { slug: sourceSlug } });
  await f.db.article.create({ data: { worldId: f.world.id, title: "Existing copy slug", slug: `${"s".repeat(115)}-copy` } });

  const cloned = await f.send(f.article.id, "/clone");
  assert.equal(cloned.status, 201, await cloned.clone().text());
  const clone = await cloned.json();
  assert.equal(clone.slug.length, 120);
  assert.equal(clone.slug, `${"s".repeat(113)}-copy-1`);

  const exported = await f.owned(`${origin}/api/worlds/${f.world.id}/export`);
  assert.equal(exported.status, 200, await exported.clone().text());
  const bundle = await exported.json();
  const imported = await f.owned(`${origin}/api/worlds/import`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bundle),
  });
  assert.equal(imported.status, 200, await imported.clone().text());
  const result = await imported.json();
  try {
    const restoredClone = await f.db.article.findFirstOrThrow({ where: { worldId: result.worldId, slug: clone.slug } });
    assert.equal(restoredClone.title, clone.title);
  } finally {
    await f.db.world.delete({ where: { id: result.worldId } });
  }
});

test("clone rolls back article, policy, revision and graph on failure at every dependent write", { skip: !origin }, async context => {
  const f = await fixture(context);
  const state = async () => ({
    articles: await f.db.article.findMany({ where: { worldId: f.world.id }, orderBy: { id: "asc" }, include: { revisions: true, outboundMentions: true } }),
    policies: await f.db.audiencePolicy.findMany({ where: { worldId: f.world.id }, orderBy: { id: "asc" } }),
  });
  for (const [table, predicate] of [
    ["AudiencePolicy", `NEW.worldId = '${f.world.id}'`],
    ["ArticleRevision", `NEW.articleId <> '${f.article.id}' AND NEW.articleId IN (SELECT id FROM Article WHERE worldId = '${f.world.id}')`],
    ["ArticleMention", `NEW.sourceArticleId <> '${f.article.id}' AND NEW.sourceArticleId IN (SELECT id FROM Article WHERE worldId = '${f.world.id}')`],
  ]) {
    const before = await state();
    await f.db.$executeRawUnsafe(`CREATE TRIGGER r07_clone_failure BEFORE INSERT ON ${table} WHEN ${predicate} BEGIN SELECT RAISE(ABORT, 'R07 injected clone failure'); END`);
    try {
      assert.equal((await f.send(f.article.id, "/clone")).status, 500, table);
      assert.deepEqual(await state(), before, `${table} failure leaves no partial clone lifecycle`);
    } finally {
      await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r07_clone_failure");
    }
  }
});

test("overlapping restore and versioned save preserve a coherent article, revision history and mention graph", { skip: !origin }, async context => {
  const f = await fixture(context);
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await f.state();
    const [restore, save] = await Promise.all([
      f.send(f.article.id, "/revisions", { revisionId: f.revision.id }),
      f.send(f.article.id, "", { expectedVersion: before.version, title: "Overlapping save", contentHtml: "<p>Save content</p>" }, "PATCH"),
    ]);
    assert.equal(restore.status, 200, await restore.clone().text());
    assert.ok([200, 409].includes(save.status), await save.clone().text());
    const after = await f.state();
    assert.deepEqual(snapshot(after), snapshot(f.revision));
    const commits = save.status === 200 ? 2 : 1;
    assert.equal(after.version, before.version + commits);
    assert.equal(after.revisions.length, before.revisions.length + commits);
    assert.deepEqual(after.outboundMentions.map(edge => edge.targetArticleId), [f.target.id]);
  }
});

test("restore and clone reject foreign owners and unrelated revisions without side effects", { skip: !origin }, async context => {
  const f = await fixture(context);
  const stranger = await f.db.user.create({ data: { name: "Other owner", email: `revision-stranger-${randomUUID()}@example.invalid` } });
  context.after(() => f.db.user.delete({ where: { id: stranger.id } }).then(() => undefined));
  const foreignFetch = await authorFetch(f.db, stranger.id, origin!);
  const before = await f.state();
  for (const action of ["clone", "revisions"]) {
    const response = await foreignFetch(`${origin}/api/articles/${f.article.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revisionId: f.revision.id }) });
    assert.equal(response.status, 404);
  }
  assert.equal((await f.send(f.article.id, "/revisions")).status, 400);
  assert.equal((await f.send(f.target.id, "/revisions", { revisionId: f.revision.id })).status, 404);
  assert.equal((await f.send(f.article.id, "/revisions", { revisionId: randomUUID() })).status, 404);
  assert.deepEqual(await f.state(), before);
});
