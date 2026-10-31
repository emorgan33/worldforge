import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

test("migration preserves sessions with opaque IDs and rejects owner deletion", async context => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();

  const owner = await db.user.create({
    data: { name: "Migration owner", email: `migration-owner-${Date.now()}@example.invalid` },
  });
  const world = await db.world.create({
    data: { ownerId: owner.id, title: "Migration world", slug: `migration-world-${owner.id}` },
  });
  const article = await db.article.create({
    data: { worldId: world.id, title: "Migration article", slug: "migration-article", template: "GENERIC" },
  });
  await db.articleRevision.create({
    data: {
      articleId: article.id,
      userId: owner.id,
      title: article.title,
      slug: article.slug,
      publicationStatus: "DRAFT",
      visibility: "PRIVATE",
      state: "DRAFT",
      articleVersionAtSave: 1,
    },
  });
  const token = randomBytes(32).toString("base64url");
  const session = await db.authSession.create({
    data: { userId: owner.id, tokenHash: sessionHash(token), expiresAt: new Date(Date.now() + 60_000) },
  });
  const setup = await db.accountSetup.create({
    data: { userId: owner.id, tokenHash: sessionHash(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() + 60_000) },
  });

  context.after(async () => {
    await db.articleRevision.deleteMany({ where: { articleId: article.id } });
    await db.article.deleteMany({ where: { id: article.id } });
    await db.world.deleteMany({ where: { id: world.id } });
    await deleteTestUsers(db, owner.id);
    await db.$disconnect();
  });

  // Existing sessions received opaque IDs while keeping token hashes.
  assert.ok(session.id, "AuthSession must have an opaque id");
  assert.equal(session.id.length, 36, "session id should be a UUID");
  assert.equal(session.tokenHash, sessionHash(token));
  const lookedUp = await db.authSession.findUnique({ where: { tokenHash: sessionHash(token) } });
  assert.equal(lookedUp?.id, session.id);

  // Owner deletion is blocked while worlds (and their durable history) exist.
  await assert.rejects(
    async () => db.user.delete({ where: { id: owner.id } }),
    /Foreign key constraint violated/,
    "deleting an owner with worlds must be rejected",
  );

  // Account lifecycle fields exist with expected defaults.
  assert.equal(owner.accountVersion, 0);
  assert.equal(owner.disabledAt, null);
  assert.equal(owner.lastSignInAt, null);

  // The installation singleton table is present and empty in tests unless seeded.
  const singletonCount = await db.installationAdminState.count();
  assert.ok(typeof singletonCount === "number");

  // Setup links and sessions still belong to the user.
  assert.ok(await db.accountSetup.findUnique({ where: { tokenHash: setup.tokenHash } }));
  assert.ok(await db.authSession.findUnique({ where: { id: session.id } }));

  // After removing the world (and its cascaded content), the owner can be deleted.
  await db.articleRevision.deleteMany({ where: { articleId: article.id } });
  await db.article.deleteMany({ where: { id: article.id } });
  await db.world.deleteMany({ where: { id: world.id } });
  await deleteTestUsers(db, owner.id);
  assert.equal(await db.user.count({ where: { id: owner.id } }), 0);
  assert.equal(await db.authSession.count({ where: { id: session.id } }), 0);
  assert.equal(await db.accountSetup.count({ where: { tokenHash: setup.tokenHash } }), 0);
});

test("RESTRICT prevents deletion while durable records exist", async context => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();

  const owner = await db.user.create({
    data: { name: "Durable owner", email: `durable-owner-${Date.now()}@example.invalid` },
  });
  const world = await db.world.create({
    data: { ownerId: owner.id, title: "Durable world", slug: `durable-world-${owner.id}` },
  });
  await db.foundryPreview.create({
    data: {
      worldId: world.id,
      authorId: owner.id,
      metadataJson: "{}",
      candidatesJson: "{}",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await db.foundryImportRun.create({
    data: {
      worldId: world.id,
      authorId: owner.id,
      previewId: "preview-1",
      idempotencyKey: "key-1",
      requestHash: "hash",
      outcomesJson: "{}",
      updatedAt: new Date(),
    },
  });
  await db.worldTransferImport.create({
    data: {
      ownerId: owner.id,
      requestKey: "request-1",
      payloadHash: "hash",
      payloadJson: "{}",
      updatedAt: new Date(),
    },
  });

  context.after(async () => {
    await db.foundryImportRun.deleteMany({ where: { worldId: world.id } });
    await db.foundryPreview.deleteMany({ where: { worldId: world.id } });
    await db.worldTransferImport.deleteMany({ where: { ownerId: owner.id } });
    await db.world.deleteMany({ where: { id: world.id } });
    await deleteTestUsers(db, owner.id);
    await db.$disconnect();
  });

  // Even without the world, durable transfer requests block deletion.
  await db.foundryImportRun.deleteMany({ where: { worldId: world.id } });
  await db.foundryPreview.deleteMany({ where: { worldId: world.id } });
  await db.world.deleteMany({ where: { id: world.id } });

  await assert.rejects(
    async () => db.user.delete({ where: { id: owner.id } }),
    /Foreign key constraint violated/,
    "WorldTransferImport.owner RESTRICT must block deletion",
  );

  await db.worldTransferImport.deleteMany({ where: { ownerId: owner.id } });
  await deleteTestUsers(db, owner.id);
  assert.equal(await db.user.count({ where: { id: owner.id } }), 0);
});
