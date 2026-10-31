import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { setAccountRole } from "../src/lib/admin-accounts";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

test("world creation validates, retries concurrent requests, and allocates collision-safe slugs", { skip: !process.env.WORLD_CREATION_TEST_DATABASE_URL }, async () => {
  assertIsolatedTestEnvironment();
  process.env.DATABASE_URL = process.env.WORLD_CREATION_TEST_DATABASE_URL;
  const { normalizeWorldCreation, createWorld } = await import("../src/lib/world-creation");
  const { prisma } = await import("../src/lib/db");
  const owner = await prisma.user.create({ data: { name: "Creation test", email: `world-create-${randomUUID()}@example.invalid` } });
  const otherOwner = await prisma.user.create({ data: { name: "Creation other owner", email: `world-create-other-${randomUUID()}@example.invalid` } });
  const db2 = new PrismaClient();
  const additionalUserIds: string[] = [];
  try {
    const requestId = randomUUID();
    const payload = normalizeWorldCreation({ title: "  The   Ashen Coast ", description: "  First shore. ", system: "PF_2E", requestId });
    assert(payload);
    assert.equal(payload.title, "The Ashen Coast");
    assert.equal(payload.description, "First shore.");
    assert.equal(normalizeWorldCreation({ title: "Bad", system: "DND_5E", requestId, ownerId: owner.id }), null);
    assert.equal(normalizeWorldCreation({ title: "Bad", system: "DND_5E_2024", requestId }), null);
    assert.equal(normalizeWorldCreation({ title: "Bad", system: "DND_5E", requestId: "nope" }), null);
    const [first, retry] = await Promise.all([createWorld(owner.id, payload), createWorld(owner.id, payload)]);
    assert.equal([first, retry].filter(result => result.created).length, 1);
    assert.equal(first.world.id, retry.world.id);
    assert.equal(first.world.isPublic, false);
    assert.equal(first.world.system, "PF_2E");
    assert.match(first.world.slug, /^the-ashen-coast-[a-f0-9]{10}$/);
    const [raceA, raceB] = await Promise.all([
      createWorld(owner.id, { ...payload, requestId: randomUUID(), title: "Race A" }),
      createWorld(owner.id, { ...payload, requestId: randomUUID(), title: "Race B" }),
    ]);
    assert.equal(raceA.created && raceB.created, true);
    const clashKey = randomUUID();
    const [changedA, changedB] = await Promise.all([
      createWorld(owner.id, { ...payload, requestId: clashKey, title: "Different coast A" }),
      createWorld(owner.id, { ...payload, requestId: clashKey, title: "Different coast B" }),
    ]);
    assert.equal([changedA, changedB].filter(result => result.conflict).length, 1);
    const changed = await createWorld(owner.id, { ...payload, requestId: clashKey, title: "Different coast C" });
    assert.equal(changed.conflict, true);
    const otherOwnerRetryKey = payload.requestId;
    const otherOwnerWorld = await createWorld(otherOwner.id, { ...payload, requestId: otherOwnerRetryKey });
    assert.equal(otherOwnerWorld.created, true);
    const collisionSlug = `collision-${randomUUID()}`;
    await prisma.world.create({ data: { ownerId: owner.id, title: "Existing", slug: collisionSlug } });
    const attemptSlugs = [collisionSlug, `collision-recovered-${randomUUID()}`];
    let attempts = 0;
    const slugRetry = await createWorld(owner.id, { ...payload, title: "Collision", requestId: randomUUID() }, () => attemptSlugs[attempts++]);
    assert.equal(slugRetry.created, true);
    assert.equal(slugRetry.world.slug, attemptSlugs[1]);
    const distinct = await createWorld(owner.id, { ...payload, requestId: randomUUID() });
    assert.equal(distinct.created, true);
    assert.notEqual(distinct.world.id, first.world.id);
    const nullKeyWorld = await prisma.world.create({ data: { ownerId: owner.id, title: "No key A", slug: `null-a-${randomUUID()}` } });
    const anotherNullKeyWorld = await prisma.world.create({ data: { ownerId: owner.id, title: "No key B", slug: `null-b-${randomUUID()}` } });
    assert.notEqual(nullKeyWorld.id, anotherNullKeyWorld.id);

    const eligibleTarget = await prisma.user.create({ data: { name: "Eligibility race", email: `eligibility-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    const admin = await prisma.user.create({ data: { name: "Eligibility admin", email: `eligibility-admin-${randomUUID()}@example.invalid`, role: "ADMIN" } });
    additionalUserIds.push(eligibleTarget.id, admin.id);
    const sessionToken = randomUUID().replaceAll("-", "").padEnd(43, "x").slice(0, 43);
    const session = await prisma.authSession.create({ data: { userId: admin.id, tokenHash: createHash("sha256").update(sessionToken).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
    const actor = { type: "WEB_ADMIN" as const, userId: admin.id, sessionId: session.id };
    const racePayload = { ...payload, title: "Eligibility-race world", requestId: randomUUID() };
    const [creation, demotion] = await Promise.allSettled([
      createWorld(eligibleTarget.id, racePayload, undefined, undefined, db2),
      setAccountRole(prisma, actor, { userId: eligibleTarget.id, expectedVersion: 0 }, { role: "PLAYER" }),
    ]);
    const finalTarget = await prisma.user.findUniqueOrThrow({ where: { id: eligibleTarget.id } });
    const ownedWorlds = await prisma.world.findMany({ where: { ownerId: eligibleTarget.id } });
    assert.ok(finalTarget.role !== "PLAYER" || ownedWorlds.length === 0, "a demoted PLAYER cannot own a newly created world");
    assert.ok(creation.status === "fulfilled" || creation.reason instanceof Error);
    if (creation.status === "fulfilled") assert.equal(creation.value.created, true);
    assert.equal(demotion.status, "fulfilled");
    if (demotion.status === "fulfilled") {
      if (demotion.value.ok) assert.equal(finalTarget.role, "PLAYER");
      else assert.equal(demotion.value.error.code, "OWNS_WORLDS");
    }
  } finally {
    await db2.$disconnect();
    await deleteTestUsers(prisma, owner.id, otherOwner.id, ...additionalUserIds);
  }
});
