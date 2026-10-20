import { test, before, after } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import { authorFetch } from "./auth-fixture";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const origin = process.env.WORLDFORGE_TEST_ORIGIN;
let authenticatedFetch: fetcherType;
type fetcherType = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let ownerId: string;
let worldId: string;
let stamp: number;
let playerId: string;
let articleGmOnlyId: string;
let articlePlayerSnapshotId: string;
let articlePublicId: string;
let sessionId: string;

before(async () => {
  stamp = Date.now();
  ownerId = (await db.user.create({
    data: { name: `Backup Fixture Owner ${stamp}`, email: `backup-owner-${stamp}@example.invalid` },
  })).id;
  playerId = (await db.user.create({
    data: { name: `Backup Fixture Player ${stamp}`, email: `backup-player-${stamp}@example.invalid` },
  })).id;
  if (origin) authenticatedFetch = await authorFetch(db, ownerId, origin);
  worldId = (await db.world.create({
    data: { ownerId, title: `Backup World ${stamp}`, slug: `backup-${stamp}` },
  })).id;

  // Articles with different audience settings
  articleGmOnlyId = (await db.article.create({
    data: { worldId, slug: `gm-only-${stamp}`, title: "GM Only", template: "GENERIC", contentHtml: "<p>Secret GM info</p>" },
  })).id;
  articlePlayerSnapshotId = (await db.article.create({
    data: { worldId, slug: `player-snapshot-${stamp}`, title: "Player Snapshot", template: "GENERIC", contentHtml: "<p>Player visible</p>" },
  })).id;
  articlePublicId = (await db.article.create({
    data: { worldId, slug: `public-${stamp}`, title: "Public Article", template: "GENERIC", contentHtml: "<p>Public info</p>" },
  })).id;

  // Audience policies
  await db.audiencePolicy.create({ data: { id: randomUUID(), worldId, resourceKind: "articles", resourceId: articleGmOnlyId, mode: "GM_ONLY" } });
  await db.audiencePolicy.create({ data: { id: randomUUID(), worldId, resourceKind: "articles", resourceId: articlePlayerSnapshotId, mode: "PLAYER_SNAPSHOT" } });
  await db.audiencePolicy.create({ data: { id: randomUUID(), worldId, resourceKind: "articles", resourceId: articlePublicId, mode: "PUBLIC" } });
// Grant player access to PLAYER_SNAPSHOT article
  const playerSnapshotPolicy = await db.audiencePolicy.findFirst({
    where: { worldId, resourceKind: "articles", resourceId: articlePlayerSnapshotId },
  });
  if (playerSnapshotPolicy) {
    await db.audienceGrant.create({
      data: { id: randomUUID(), policyId: playerSnapshotPolicy.id, userId: playerId },
    });
  }

  // Add player as member
  await db.worldMember.create({
    data: { id: randomUUID(), worldId, userId: playerId, role: "PLAYER", status: "ACTIVE" },
  });

  sessionId = (await db.campaignSession.create({ data: { worldId, title: "Session 1", order: 1, status: "PLANNED" } })).id;

  // Create an audit event
  await db.accessAuditEvent.create({
    data: { id: randomUUID(), worldId, action: "test.seed", actorId: ownerId, resourceKind: "articles", resourceId: articleGmOnlyId },
  });
});
after(async () => {
  const worldsToDelete = await db.world.findMany({
    where: { OR: [{ id: worldId }, { slug: { startsWith: `backup-${stamp}` } }] },
    select: { id: true },
  });
  for (const w of worldsToDelete) {
    await db.world.delete({ where: { id: w.id } }).catch(() => {});
  }
  const usersToDelete = [ownerId, playerId].filter(Boolean);
  for (const uid of usersToDelete) {
    try {
      await db.authSession.deleteMany({ where: { userId: uid } });
      await db.user.delete({ where: { id: uid } });
    } catch { /* ignore */ }
  }
  await db.$disconnect();
});

function ownerFetch(path: string, options?: RequestInit) {
  if (!origin) throw new Error("WORLDFORGE_TEST_ORIGIN is required");
  return authenticatedFetch(`${origin}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
}

test("v2 export returns complete structure with new sections", { skip: !origin }, async () => {
  const res = await ownerFetch(`/api/worlds/${worldId}/export?format=v2`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Accept-Version"), "2");

  const data = await res.json();
  assert.equal(data.formatVersion, 2);
  assert.ok(data.exportedAt);
  assert.equal(data.sourceWorldId, worldId);
  assert.ok(data.world);
  assert.ok(data.world.id, worldId);

  assert.ok(Array.isArray(data.members));
  assert.ok(Array.isArray(data.audiencePolicies));
  assert.ok(Array.isArray(data.audienceGrants));
  assert.ok(Array.isArray(data.auditEvents));
  assert.ok(Array.isArray(data.sessions));
  assert.ok(Array.isArray(data.sessionEntityLinks));

  assert.equal(data.articles.length, 3);
  assert.equal(data.members.length, 1);
  assert.equal(data.audiencePolicies.length, 3);
  assert.equal(data.audienceGrants.length, 1);
  assert.equal(data.auditEvents.length, 1);
  assert.equal(data.sessions.length, 1);
  assert.equal(data.sessions[0].id, sessionId);

  const modes = data.audiencePolicies.map((p: { mode: string }) => p.mode);
  assert.ok(modes.includes("GM_ONLY"));
  assert.ok(modes.includes("PLAYER_SNAPSHOT"));
  assert.ok(modes.includes("PUBLIC"));
});
test("v2 import creates world with new IDs and inactive memberships", { skip: !origin }, async () => {
  const exportRes = await ownerFetch(`/api/worlds/${worldId}/export?format=v2`);
  const exportData = await exportRes.json();
  assert.equal(exportData.formatVersion, 2);

  const importRes = await ownerFetch("/api/worlds/import", {
    method: "POST",
    body: JSON.stringify(exportData),
  });
  assert.equal(importRes.status, 200);
  const importResult = await importRes.json();
  assert.equal(importResult.success, true);
  assert.ok(importResult.worldId);
  assert.notEqual(importResult.worldId, worldId);

  const importedWorld = await db.world.findUnique({ where: { id: importResult.worldId } });
  assert.ok(importedWorld);
  assert.equal(importedWorld.isPublic, false);

  const importedArticles = await db.article.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(importedArticles.length, 3);

  const importedMembers = await db.worldMember.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(importedMembers.length, 1);
  assert.equal(importedMembers[0].status, "REVOKED");

  const importedPolicies = await db.audiencePolicy.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(importedPolicies.length, 3);

  const importedGrants = await db.audienceGrant.findMany({
    where: { policy: { worldId: importResult.worldId } },
  });
  assert.equal(importedGrants.length, 1);

  const importedAuditEvents = await db.accessAuditEvent.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(importedAuditEvents.length, 1);
  assert.equal(importedAuditEvents[0].action, "test.seed");

  const importedSessions = await db.campaignSession.findMany({ where: { worldId: importResult.worldId } });
  assert.equal(importedSessions.length, 1);
  assert.equal(importedSessions[0].title, "Session 1");

  assert.equal(importResult.imported.categories, 0);
  assert.equal(importResult.imported.articles, 3);
  assert.equal(importResult.imported.members, 1);
  assert.equal(importResult.imported.audiencePolicies, 3);
  assert.equal(importResult.imported.audienceGrants, 1);
  assert.equal(importResult.imported.auditEvents, 1);
  assert.equal(importResult.imported.sessions, 1);

  await db.world.delete({ where: { id: importResult.worldId } }).catch(() => {});
});

test("v1 export still works for backward compatibility", { skip: !origin }, async () => {
  const res = await ownerFetch(`/api/worlds/${worldId}/export`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, 1);
  assert.ok(data.exportedAt);
  assert.ok(data.world);
  assert.equal(data.world.id, worldId);
  assert.equal((data as Record<string, unknown>).formatVersion, undefined);
});

test("v1 import still works for v1 format data", { skip: !origin }, async () => {
  const exportRes = await ownerFetch(`/api/worlds/${worldId}/export?includePrivate=true`);
  const exportData = await exportRes.json();
  assert.equal(exportData.version, 1);

  const importRes = await ownerFetch("/api/worlds/import", {
    method: "POST",
    body: JSON.stringify(exportData),
  });
  assert.equal(importRes.status, 200);
  const result = await importRes.json();
  assert.equal(result.success, true);
  assert.ok(result.worldId);

  await db.world.delete({ where: { id: result.worldId } }).catch(() => {});
});
