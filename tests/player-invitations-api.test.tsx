import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("player invitations are email-bound, single-use, and do not grant author APIs", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Invitation GM", email: `gm-${stamp}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Invitation world", slug: `invite-${stamp}` } });
  const email = `player-${stamp}@example.invalid`;
  context.after(async () => {
    await db.world.delete({ where: { id: world.id } });
    const player = await db.user.findUnique({ where: { email } });
    await deleteTestUsers(db, owner.id, player?.id);
    await db.$disconnect();
  });
  const gmFetch = await authorFetch(db, owner.id, origin!);
  const invite = await gmFetch(`${origin}/api/worlds/${world.id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  assert.equal(invite.status, 201);
  const { claimUrl } = await invite.json();
  const link = new URL(claimUrl);
  assert.equal(link.pathname, "/invite");
  assert.equal(link.search, "");
  const token = new URLSearchParams(link.hash.slice(1)).get("token");
  assert(token);

  const preview = await fetch(`${origin}/api/invitations/preview`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ token }) });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).invitation.email, email);
  const claim = await fetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ token, name: "Player", password: "long-enough-password" }) });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).worldSlug, world.slug);
  const player = await db.user.findUniqueOrThrow({ where: { email } });
  assert.equal(player.role, "PLAYER");
  assert.equal((await db.worldMember.findUniqueOrThrow({ where: { worldId_userId: { worldId: world.id, userId: player.id } } })).status, "ACTIVE");
  assert.equal((await fetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ token, name: "Second", password: "long-enough-password" }) })).status, 404);

  const playerFetch = await authorFetch(db, player.id, origin!);
  const home = await playerFetch(`${origin}/api/player/worlds`);
  assert.equal(home.status, 200);
  assert.deepEqual((await home.json()).worlds.map((entry: { id: string }) => entry.id), [world.id]);
  const createWorld = await playerFetch(`${origin}/api/worlds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Forbidden" }) });
  assert.equal(createWorld.status, 403);
  assert.equal((await playerFetch(`${origin}/api/worlds`)).status, 403);
  assert.equal((await playerFetch(`${origin}/api/worlds/${world.id}/members`)).status, 403);
  assert.equal((await playerFetch(`${origin}/api/worlds/${world.id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `third-${stamp}@example.invalid` }) })).status, 403);
  const secretArticle = await db.article.create({ data: { worldId: world.id, title: "GM secret", slug: `gm-secret-${stamp}` } });
  assert.equal((await playerFetch(`${origin}/api/articles/${secretArticle.id}`)).status, 403);
});

test("existing author invitation preserves role and ownership; cancelled links cannot be claimed", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Owner", email: `owner-${stamp}@example.invalid` } });
  const invited = await db.user.create({ data: { name: "Other GM", email: `other-${stamp}@example.invalid`, role: "AUTHOR" } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Shared", slug: `shared-${stamp}` } });
  const ownWorld = await db.world.create({ data: { ownerId: invited.id, title: "Owned", slug: `owned-${stamp}` } });
  context.after(async () => {
    await db.world.deleteMany({ where: { id: { in: [world.id, ownWorld.id] } } });
    await deleteTestUsers(db, owner.id, invited.id);
    await db.$disconnect();
  });
  const gmFetch = await authorFetch(db, owner.id, origin!);
  const invitedFetch = await authorFetch(db, invited.id, origin!);
  assert.equal((await invitedFetch(`${origin}/api/worlds/${world.id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: invited.email }) })).status, 404);
  const create = async () => {
    const response = await gmFetch(`${origin}/api/worlds/${world.id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: invited.email }) });
    assert.equal(response.status, 201);
    const data = await response.json();
    return { id: data.invitation.id as string, token: new URLSearchParams(new URL(data.claimUrl).hash.slice(1)).get("token")! };
  };
  const cancelled = await create();
  assert.equal((await invitedFetch(`${origin}/api/worlds/${world.id}/invitations/${cancelled.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await gmFetch(`${origin}/api/worlds/${world.id}/invitations/${cancelled.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await invitedFetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: cancelled.token }) })).status, 404);
  const active = await create();
  assert.equal((await fetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ token: active.token }) })).status, 403);
  assert.equal((await gmFetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: active.token }) })).status, 403);
  assert.equal((await invitedFetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: active.token }) })).status, 200);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: invited.id } })).role, "AUTHOR");
  assert.equal((await db.world.findUniqueOrThrow({ where: { id: ownWorld.id } })).ownerId, invited.id);
  const expired = await create();
  await db.playerInvitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await invitedFetch(`${origin}/api/invitations/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: expired.token }) })).status, 404);
  assert.equal((await invitedFetch(`${origin}/api/invitations/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: expired.token }) })).status, 404);
});
