import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;

test("player access: denied paths return 404 without leaking resource info", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "GM owner", email: `gm-${stamp}@example.invalid` } });
  const playerA = await db.user.create({ data: { name: "Player A", email: `player-a-${stamp}@example.invalid` } });
  const playerB = await db.user.create({ data: { name: "Player B", email: `player-b-${stamp}@example.invalid` } });
  const outsider = await db.user.create({ data: { name: "Outsider", email: `out-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.user.deleteMany({ where: { id: { in: [owner.id, playerA.id, playerB.id, outsider.id] } } });
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Table test", slug: `table-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `secret-${stamp}`, title: "SECRET_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE", contentHtml: "HIDDEN_BODY" } });

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const aFetch = await authorFetch(db, playerA.id, origin!);
  const bFetch = await authorFetch(db, playerB.id, origin!);
  const outFetch = await authorFetch(db, outsider.id, origin!);

  const checkDenied = async (fetchFn: Function, path: string) => {
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
    await db.user.deleteMany({ where: { id: { in: [owner.id, player.id] } } });
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

  // Player can now read
  const allowedRes = await pFetch(`${origin}/api/articles/${article.id}`);
  assert.equal(allowedRes.status, 200);
  const body = await allowedRes.json();
  assert.equal(body.title, "Shared article");
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
    await db.user.deleteMany({ where: { id: { in: [owner.id, playerA.id, playerB.id] } } });
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

  // Player A reads, Player B denied
  const aRes = await aFetch(`${origin}/api/articles/${article.id}`);
  assert.equal(aRes.status, 200);

  const bRes = await bFetch(`${origin}/api/articles/${article.id}`);
  assert.equal(bRes.status, 404);
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
    await db.user.deleteMany({ where: { id: { in: [owner.id, playerA.id, playerB.id] } } });
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

test("player access: revocation takes effect immediately", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "GM", email: `gm4-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Player", email: `ply4-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, player.id] } } });
    await db.$disconnect();
  });

  const world = await db.world.create({ data: { ownerId: owner.id, title: "Revoke", slug: `revoke-${stamp}`, isPublic: false } });
  const article = await db.article.create({ data: { worldId: world.id, slug: `rev-${stamp}`, title: "Revocable", publicationStatus: "PUBLISHED", visibility: "PRIVATE" } });

  const gmFetch = await authorFetch(db, owner.id, origin!);
  const pFetch = await authorFetch(db, player.id, origin!);

  await gmFetch(`${origin}/api/worlds/${world.id}/members`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: player.id }),
  });
  await gmFetch(`${origin}/api/resources/articles/${article.id}/audience`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [player.id] }),
  });

  assert.equal((await pFetch(`${origin}/api/articles/${article.id}`)).status, 200);

  // Revoke
  const revokeRes = await gmFetch(`${origin}/api/worlds/${world.id}/members/${player.id}`, { method: "DELETE" });
  assert.equal(revokeRes.status, 200);

  // Immediate denial
  assert.equal((await pFetch(`${origin}/api/articles/${article.id}`)).status, 404);
});

test("audit: events recorded for member actions", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Audit GM", email: `audit-gm-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Audit P", email: `audit-ply-${stamp}@example.invalid` } });

  context.after(async () => {
    await db.accessAuditEvent.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, player.id] } } });
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
  assert(actions.includes("create_policy"));
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
    await db.user.delete({ where: { id: owner.id } });
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
