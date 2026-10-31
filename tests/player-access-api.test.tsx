import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { writeAsset, removeAssetFile } from "../src/lib/asset-storage";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("player access: denied paths return 404 without leaking resource info", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "GM owner", email: `gm-${stamp}@example.invalid` } });
  const playerA = await db.user.create({ data: { name: "Player A", email: `player-a-${stamp}@example.invalid` } });
  const playerB = await db.user.create({ data: { name: "Player B", email: `player-b-${stamp}@example.invalid` } });
  const outsider = await db.user.create({ data: { name: "Outsider", email: `out-${stamp}@example.invalid` } });

  context.after(async () => {
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id, outsider.id);
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Table test", slug: `table-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `secret-${stamp}`, title: "SECRET_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE", contentHtml: "HIDDEN_BODY" } });

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const aFetch = await authorFetch(db, playerA.id, origin!);
  const outFetch = await authorFetch(db, outsider.id, origin!);

  // Author collection endpoints must never treat missing worldId as all worlds.
  for (const path of ["/api/articles", "/api/secrets", "/api/statblocks", "/api/assets"]) {
    assert.equal((await outFetch(`${origin}${path}`)).status, 404);
    assert.equal((await gmFetch(`${origin}${path}`)).status, 404);
  }
  const upload = new FormData();
  upload.set("worldId", world.id);
  upload.set("file", new File(["not an image"], "probe.webp", { type: "image/webp" }));
  assert.equal((await outFetch(`${origin}/api/assets`, { method: "POST", body: upload })).status, 404);

  const checkDenied = async (fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, path: string) => {
    const res = await fetchFn(`${origin}${path}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Not found.");
    assert(!JSON.stringify(body).includes("SECRET_SENTINEL"));
    assert(!JSON.stringify(body).includes("HIDDEN_BODY"));
  };

  // Direct article read
  await checkDenied(aFetch, `/api/articles/${article.id}`);

  // Article list
  const listRes = await aFetch(`${origin}/api/articles?worldId=${world.id}`);
  assert.equal(listRes.status, 404);

  // Search
  const searchRes = await aFetch(`${origin}/api/search?worldId=${world.id}&q=SECRET`);
  assert.equal(searchRes.status, 404);

  // Statblocks
  const block = await db.rpgBlock.create({ data: { worldId: world.id, name: "Secret monster", system: "DND_5E", category: "MONSTER", statsJson: "{}" } });
  await checkDenied(aFetch, `/api/statblocks/${block.id}`);

  // Export
  await checkDenied(aFetch, `/api/worlds/${world.id}/export`);

  // Outsider also denied
  await checkDenied(outFetch, `/api/articles/${article.id}`);

  // GM can still access
  const gmRes = await gmFetch(`${origin}/api/articles/${article.id}`);
  assert.equal(gmRes.status, 200);
  const gmBody = await gmRes.json();
  assert.equal(gmBody.title, "SECRET_SENTINEL");
});

test("player access: membership + policy grants access", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "GM", email: `gm2-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Player", email: `ply-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, player.id);
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Membership test", slug: `member-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `shared-${stamp}`, title: "Shared article", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const pFetch = await authorFetch(db, player.id, origin!);

  // Add player as member
  const addRes = await gmFetch(`${origin}/api/worlds/${world.id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: player.id }),
  });
  assert.equal(addRes.status, 200);

  // Player is member but article is GM_ONLY — still denied
  const deniedRes = await pFetch(`${origin}/api/articles/${article.id}`);
  assert.equal(deniedRes.status, 404);

  // Create a PLAYER_SNAPSHOT policy granting access
  const policyRes = await gmFetch(`${origin}/api/resources/articles/${article.id}/audience`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }),
  });
  assert.equal(policyRes.status, 200);

  // Author APIs include GM-only fields and stay owner-only after a grant.
  const allowedRes = await pFetch(`${origin}/api/articles/${article.id}`);
  assert.equal(allowedRes.status, 404);
  const readerRes = await pFetch(`${origin}/c/${world.slug}/a/${article.slug}`);
  assert.equal(readerRes.status, 200);
  assert((await readerRes.text()).includes("Shared article"));
});

test("player access: later member does not inherit grants", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "GM", email: `gm3-${stamp}@example.invalid` } });
  const playerA = await db.user.create({ data: { name: "Player A", email: `plyA-${stamp}@example.invalid` } });
  const playerB = await db.user.create({ data: { name: "Player B", email: `plyB-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Inheritance", slug: `inherit-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `sel-${stamp}`, title: "Selected share", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const aFetch = await authorFetch(db, playerA.id, origin!);
  const bFetch = await authorFetch(db, playerB.id, origin!);

  // Add both, share only to A
  await gmFetch(`${origin}/api/worlds/${world.id}/members`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: playerA.id }),
  });
  await gmFetch(`${origin}/api/worlds/${world.id}/members`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: playerB.id }),
  });
  await gmFetch(`${origin}/api/resources/articles/${article.id}/audience`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [playerA.id] }),
  });

  // Player A reads via the filtered reader, while author detail stays private.
  assert.equal((await aFetch(`${origin}/api/articles/${article.id}`)).status, 404);
  const aRes = await aFetch(`${origin}/c/${world.slug}/a/${article.slug}`);
  assert.equal(aRes.status, 200);

  const bRes = await bFetch(`${origin}/c/${world.slug}/a/${article.slug}`);
  assert(!((await bRes.text()).includes("Selected share")));
});

test("player discovery surfaces only policy-readable article metadata", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Discovery GM", email: `discovery-gm-${stamp}@example.invalid` } });
  const playerA = await db.user.create({ data: { name: "Discovery A", email: `discovery-a-${stamp}@example.invalid` } });
  const playerB = await db.user.create({ data: { name: "Discovery B", email: `discovery-b-${stamp}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Discovery", slug: `discovery-${stamp}`, isPublic: false } });
  context.after(async () => {
    await db.world.deleteMany({ where: { id: world.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });

  const visible = await db.article.create({ data: { worldId: world.id, slug: `visible-${stamp}`, title: "VISIBLE_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  const otherPlayer = await db.article.create({ data: { worldId: world.id, slug: `other-${stamp}`, title: "OTHER_PLAYER_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  await db.article.create({ data: { worldId: world.id, slug: `gm-${stamp}`, title: "GM_ONLY_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  const gmFetch = await authorFetch(db, owner.id, origin!);
  const playerFetch = await authorFetch(db, playerA.id, origin!);
  for (const userId of [playerA.id, playerB.id]) {
    assert.equal((await gmFetch(`${origin}/api/worlds/${world.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) })).status, 200);
  }
  for (const [articleId, userId] of [[visible.id, playerA.id], [otherPlayer.id, playerB.id]] as const) {
    assert.equal((await gmFetch(`${origin}/api/resources/articles/${articleId}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [userId] }) })).status, 200);
  }

  const search = await playerFetch(`${origin}/api/c/${world.slug}/search?q=SENTINEL`);
  assert.equal(search.status, 200);
  const searchBody = JSON.stringify(await search.json());
  assert(searchBody.includes("VISIBLE_SENTINEL"));
  assert(!searchBody.includes("OTHER_PLAYER_SENTINEL"));
  assert(!searchBody.includes("GM_ONLY_SENTINEL"));

  const index = await playerFetch(`${origin}/c/${world.slug}`);
  assert.equal(index.status, 200);
  const indexBody = await index.text();
  assert(indexBody.includes("VISIBLE_SENTINEL"));
  assert(!indexBody.includes("OTHER_PLAYER_SENTINEL"));
  assert(!indexBody.includes("GM_ONLY_SENTINEL"));
});

test("shared articles reveal embedded assets and statblocks only after their own grants", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Embed GM", email: `embed-gm-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Embed player", email: `embed-player-${stamp}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Embeds", slug: `embeds-${stamp}` } });
  context.after(async () => {
    await db.world.delete({ where: { id: world.id } });
    await deleteTestUsers(db, owner.id, player.id);
    await db.$disconnect();
  });
  const asset = await db.imageAsset.create({ data: { worldId: world.id, title: "Hidden map", originalName: "map.webp", byteSize: 1, width: 1, height: 1, sha256: `embed-${stamp}` } });
  const block = await db.rpgBlock.create({ data: { worldId: world.id, name: "Hidden creature", system: "DND_5E", category: "MONSTER", statsJson: "{}" } });
  const article = await db.article.create({ data: { worldId: world.id, title: "Shared page", slug: `shared-embed-${stamp}`, contentJson: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `/api/assets/${asset.id}/file`, alt: "Private image" } }, { type: "campaignStatblock", attrs: { blockId: block.id } }] }) } });
  const gmFetch = await authorFetch(db, owner.id, origin!);
  const playerFetch = await authorFetch(db, player.id, origin!);
  assert.equal((await gmFetch(`${origin}/api/worlds/${world.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: player.id }) })).status, 200);
  async function share(kind: string, id: string) {
    const response = await gmFetch(`${origin}/api/resources/${kind}/${id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }) });
    assert.equal(response.status, 200);
  }
  await share("articles", article.id);
  const before = await (await playerFetch(`${origin}/c/${world.slug}/a/${article.slug}`)).text();
  assert(!before.includes(`/api/assets/${asset.id}/file`));
  assert(!before.includes("Hidden creature"));
  await share("assets", asset.id);
  await share("statblocks", block.id);
  const after = await (await playerFetch(`${origin}/c/${world.slug}/a/${article.slug}`)).text();
  assert(after.includes(`/api/assets/${asset.id}/file`));
  assert(after.includes("Hidden creature"));
  assert.equal((await playerFetch(`${origin}/api/articles/${article.id}`)).status, 404);
});

test("player article metadata removes references to unreadable articles and statblocks", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Metadata GM", email: `metadata-gm-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Metadata player", email: `metadata-player-${stamp}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Metadata", slug: `metadata-${stamp}` } });
  context.after(async () => {
    await db.world.delete({ where: { id: world.id } });
    await deleteTestUsers(db, owner.id, player.id);
    await db.$disconnect();
  });

  const readableArticle = await db.article.create({ data: { worldId: world.id, title: "Readable target", slug: `metadata-readable-${stamp}`, publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  const hiddenArticle = await db.article.create({ data: { worldId: world.id, title: "Hidden target", slug: `metadata-hidden-${stamp}`, publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  const readableBlock = await db.rpgBlock.create({ data: { worldId: world.id, name: "Readable block", system: "DND_5E", category: "MONSTER", statsJson: "{}" } });
  const hiddenBlock = await db.rpgBlock.create({ data: { worldId: world.id, name: "Hidden block", system: "DND_5E", category: "MONSTER", statsJson: "{}" } });
  const article = await db.article.create({ data: {
    worldId: world.id, title: "Encounter metadata", slug: `metadata-encounter-${stamp}`, template: "ENCOUNTER",
    metadata: JSON.stringify({
      dnd5eParticipant1: hiddenBlock.id,
      dnd5eParticipant2: readableBlock.id,
      linkedLocation: hiddenArticle.id,
      linkedPlot: readableArticle.id,
      linkedSession: hiddenArticle.id,
      linkedEncounters: `${readableArticle.id}\n${hiddenArticle.id}`,
      extension: "author-only-extension-sentinel",
    }),
  } });
  const gmFetch = await authorFetch(db, owner.id, origin!);
  const playerFetch = await authorFetch(db, player.id, origin!);
  assert.equal((await gmFetch(`${origin}/api/worlds/${world.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: player.id }) })).status, 200);
  async function share(kind: string, id: string) {
    const response = await gmFetch(`${origin}/api/resources/${kind}/${id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }) });
    assert.equal(response.status, 200);
  }
  await share("articles", article.id);
  await share("articles", readableArticle.id);
  await share("statblocks", readableBlock.id);

  const response = await playerFetch(`${origin}/c/${world.slug}/a/${article.slug}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(html.includes(readableArticle.id));
  assert(html.includes(readableBlock.id));
  for (const hidden of [hiddenArticle.id, hiddenBlock.id, "author-only-extension-sentinel"]) assert(!html.includes(hidden), `reader output leaked ${hidden}`);
});

test("player access: revocation takes effect immediately", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "GM", email: `gm4-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Player", email: `ply4-${stamp}@example.invalid` } });

  let assetId: string | null = null;
  context.after(async () => {
    if (assetId) await removeAssetFile(assetId);
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, player.id);
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Revoke", slug: `revoke-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `rev-${stamp}`, title: "Revocable", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  const asset = await db.imageAsset.create({ data: { worldId: world.id, title: "Revocable image", originalName: "rev.webp", byteSize: 1, width: 1, height: 1, sha256: `rev-${stamp}` } });
  assetId = asset.id;
  await writeAsset(asset.id, Buffer.from("image bytes"));

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const pFetch = await authorFetch(db, player.id, origin!);

  await gmFetch(`${origin}/api/worlds/${world.id}/members`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: player.id }),
  });
  await gmFetch(`${origin}/api/resources/articles/${article.id}/audience`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }),
  });
  assert.equal((await gmFetch(`${origin}/api/resources/assets/${asset.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }) })).status, 200);

  assert.equal((await pFetch(`${origin}/c/${world.slug}/a/${article.slug}`)).status, 200);
  assert.equal((await pFetch(`${origin}/api/c/${world.slug}/search?q=Revocable`)).status, 200);
  assert.equal((await pFetch(`${origin}/api/assets/${asset.id}/file`)).status, 200);

  // Revoke
  const revokeRes = await gmFetch(`${origin}/api/worlds/${world.id}/members/${player.id}`, { method: "DELETE" });
  assert.equal(revokeRes.status, 200);

  // Immediate denial
  assert(!((await (await pFetch(`${origin}/c/${world.slug}/a/${article.slug}`)).text()).includes("Revocable")));
  assert.equal((await pFetch(`${origin}/api/c/${world.slug}/search?q=Revocable`)).status, 404);
  const revokedAsset = await pFetch(`${origin}/api/assets/${asset.id}/file`);
  assert.equal(revokedAsset.status, 404);
  assert.equal(revokedAsset.headers.get("cache-control"), "no-store");
});

test("audit: events recorded for member actions", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Audit GM", email: `audit-gm-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Audit P", email: `audit-ply-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, player.id);
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Audit", slug: `audit-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `audit-art-${stamp}`, title: "Audited", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });

  const gmFetch = await authorFetch(db, owner.id, origin!);

  await gmFetch(`${origin}/api/worlds/${world.id}/members`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: player.id }),
  });
  await gmFetch(`${origin}/api/resources/articles/${article.id}/audience`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }),
  });
  await gmFetch(`${origin}/api/worlds/${world.id}/members/${player.id}`, { method: "DELETE" });

  const auditRes = await gmFetch(`${origin}/api/worlds/${world.id}/audit`);
  assert.equal(auditRes.status, 200);
  const auditBody = await auditRes.json();
  assert(Array.isArray(auditBody.events));

  const actions = auditBody.events.map((e: { action: string }) => e.action);
  assert(actions.includes("add_member"));
  assert(actions.includes("set_policy"));
  assert(actions.includes("revoke_member"));

  for (const event of auditBody.events) {
    assert(event.id);
    assert(event.action);
    assert(event.createdAt);
  }
});

test("player access: public reader behavior preserved", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Public GM", email: `pub-gm-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id);
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Public world", slug: `pub-${stamp}`, isPublic: true } });
  await db.article.create({ data: { worldId: world.id, slug: `pub-art-${stamp}`, title: "Public article", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const privArticle = await db.article.create({ data: { worldId: world.id, slug: `priv-art-${stamp}`, title: "PRIVATE_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });

  const pubRes = await fetch(`${origin}/api/articles/${privArticle.id}`);
  // Anonymous users are rejected by withAuthor before reaching the handler
  assert.equal(pubRes.status, 401);
  const body = await pubRes.json();
  assert.equal(body.error, "Sign in to access your workspace.");
  assert(!JSON.stringify(body).includes("PRIVATE_SENTINEL"));
});

test("explicit author declarations bind access to their declared identifier and reject cross-origin writes", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Declaration owner", email: `declaration-owner-${stamp}@example.invalid` } });
  const otherOwner = await db.user.create({ data: { name: "Declaration other", email: `declaration-other-${stamp}@example.invalid` } });
  const ownWorld = await db.world.create({ data: { ownerId: owner.id, title: "Owned declaration world", slug: `decl-own-${stamp}` } });
  const foreignWorld = await db.world.create({ data: { ownerId: otherOwner.id, title: "Foreign declaration world", slug: `decl-foreign-${stamp}` } });
  const ownArticle = await db.article.create({ data: { worldId: ownWorld.id, slug: `own-${stamp}`, title: "Own article" } });
  const foreignArticle = await db.article.create({ data: { worldId: foreignWorld.id, slug: `foreign-${stamp}`, title: "Foreign article" } });
  context.after(async () => {
    await db.world.deleteMany({ where: { id: { in: [ownWorld.id, foreignWorld.id] } } });
    await deleteTestUsers(db, owner.id, otherOwner.id);
    await db.$disconnect();
  });

  const owned = await authorFetch(db, owner.id, origin!);
  const foreignQuery = await owned(`${origin}/api/articles?worldId=${foreignWorld.id}`);
  assert.equal(foreignQuery.status, 404, "query declarations must authorize the requested world");

  const pathWins = await owned(`${origin}/api/articles/${ownArticle.id}?worldId=${foreignWorld.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Path owned article" }),
  });
  assert.equal(pathWins.status, 200, "a resource path declaration authorizes the path resource");
  assert.equal((await db.article.findUniqueOrThrow({ where: { id: ownArticle.id } })).title, "Path owned article");
  assert.equal((await db.article.findUniqueOrThrow({ where: { id: foreignArticle.id } })).title, "Foreign article");

  const bodyConflict = await owned(`${origin}/api/worlds?worldId=${ownWorld.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: foreignWorld.id, title: "Takeover", description: "No", coverImage: "", bannerImage: "" }),
  });
  assert.equal(bodyConflict.status, 404, "a body declaration must reject a foreign body ID");
  const crossOrigin = await owned(`${origin}/api/articles/${ownArticle.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://foreign.invalid" },
    body: JSON.stringify({ title: "Cross-origin takeover" }),
  });
  assert.equal(crossOrigin.status, 403);
});

test("preview sessions resolve one shared actor and stay confined to the declared world", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Preview owner", email: `preview-owner-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Preview player", email: `preview-player-${stamp}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Preview world", slug: `preview-${stamp}` } });
  const foreignWorld = await db.world.create({ data: { ownerId: owner.id, title: "Outside preview world", slug: `outside-preview-${stamp}` } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `preview-article-${stamp}`, title: "Preview-only shared article", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });
  await db.worldMember.create({ data: { worldId: world.id, userId: player.id } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });
  context.after(async () => {
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { id: { in: [world.id, foreignWorld.id] } } });
    await deleteTestUsers(db, owner.id, player.id);
    await db.$disconnect();
  });

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const issued = await gmFetch(`${origin}/api/worlds/${world.id}/preview`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: player.id }),
  });
  assert.equal(issued.status, 200);
  const { token } = await issued.json();
  assert.equal(typeof token, "string");

  const previewCookie = { Cookie: `wf_preview=${token}` };
  const previewArticle = await fetch(`${origin}/c/${world.slug}/a/${article.slug}`, { headers: previewCookie });
  assert.equal(previewArticle.status, 200);
  assert((await previewArticle.text()).includes(article.title));
  const outsidePreview = await fetch(`${origin}/c/${foreignWorld.slug}`, { headers: previewCookie });
  const outsideBody = await outsidePreview.text();
  assert(!outsideBody.includes(foreignWorld.title));
});
