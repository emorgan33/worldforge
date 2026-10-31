import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.invalid`;
}

test("migration preserves sessions with opaque IDs and rejects owner deletion", async context => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();

  const owner = await db.user.create({
    data: { name: "Migration owner", email: uniqueEmail("migration-owner") },
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

  // The installation singleton row is present exactly once after the migration.
  const singletonCount = await db.installationAdminState.count();
  assert.equal(singletonCount, 1);
  const singleton = await db.installationAdminState.findFirstOrThrow();
  assert.equal(singleton.id, 1);
  assert.equal(singleton.version, 0);

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
    data: { name: "Durable owner", email: uniqueEmail("durable-owner") },
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

test("P1 migration preserves populated pre-upgrade data and backfills session ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worldforge-admin-migration-"));
  const migrationsDir = join(dir, "migrations");
  const schemaPath = join(dir, "schema.prisma");
  const dbPath = join(dir, "upgrade.sqlite");
  const databaseUrl = `file:${dbPath}`;
  const root = process.cwd();
  try {
    await mkdir(migrationsDir);
    await cp(join(root, "prisma/schema.prisma"), schemaPath);
    const preP1Names = (await readdir(join(root, "prisma/migrations")))
      .filter(name => /^\d/.test(name) && name !== "20261030120000_installation_admin_p1")
      .sort();
    for (const name of preP1Names) await cp(join(root, "prisma/migrations", name), join(migrationsDir, name), { recursive: true });
    await writeFile(join(migrationsDir, "migration_lock.toml"), 'provider = "sqlite"\n');
    const runMigrate = () => spawnSync(process.execPath, [join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", schemaPath], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    await writeFile(dbPath, "");
    runMigrate();

    process.env.DATABASE_URL = databaseUrl;
    const { PrismaClient: HistoricPrismaClient } = await import("@prisma/client");
    const historic = new HistoricPrismaClient();
    const now = new Date().toISOString();

    // Two authors, one of whom owns worlds and durable history.
    const ownerA = { id: randomUUID(), email: `owner-a-${randomUUID()}@example.invalid` };
    const ownerB = { id: randomUUID(), email: `owner-b-${randomUUID()}@example.invalid` };
    await historic.$executeRawUnsafe('INSERT INTO "User" ("id", "name", "email", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)', ownerA.id, "Owner A", ownerA.email, "AUTHOR", now, now);
    await historic.$executeRawUnsafe('INSERT INTO "User" ("id", "name", "email", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)', ownerB.id, "Owner B", ownerB.email, "AUTHOR", now, now);

    const tokenA = randomBytes(32).toString("base64url");
    const tokenB = randomBytes(32).toString("base64url");
    await historic.$executeRawUnsafe('INSERT INTO "AuthSession" ("tokenHash", "userId", "expiresAt", "createdAt") VALUES (?, ?, ?, ?)', sessionHash(tokenA), ownerA.id, new Date(Date.now() + 60_000).toISOString(), now);
    await historic.$executeRawUnsafe('INSERT INTO "AuthSession" ("tokenHash", "userId", "expiresAt", "createdAt") VALUES (?, ?, ?, ?)', sessionHash(tokenB), ownerB.id, new Date(Date.now() + 60_000).toISOString(), now);
    await historic.$executeRawUnsafe('INSERT INTO "AccountSetup" ("tokenHash", "userId", "expiresAt") VALUES (?, ?, ?)', sessionHash(randomBytes(32).toString("base64url")), ownerA.id, new Date(Date.now() + 60_000).toISOString());

    const worldActive = { id: randomUUID(), slug: `active-${randomUUID()}` };
    const worldArchived = { id: randomUUID(), slug: `archived-${randomUUID()}` };
    await historic.$executeRawUnsafe('INSERT INTO "World" ("id", "slug", "title", "ownerId", "createdAt", "updatedAt", "deletedAt") VALUES (?, ?, ?, ?, ?, ?, ?)', worldActive.id, worldActive.slug, "Active world", ownerA.id, now, now, null);
    await historic.$executeRawUnsafe('INSERT INTO "World" ("id", "slug", "title", "ownerId", "createdAt", "updatedAt", "deletedAt") VALUES (?, ?, ?, ?, ?, ?, ?)', worldArchived.id, worldArchived.slug, "Archived world", ownerA.id, now, now, now);

    const article = { id: randomUUID(), slug: `article-${randomUUID()}` };
    await historic.$executeRawUnsafe('INSERT INTO "Article" ("id", "worldId", "slug", "title", "template", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)', article.id, worldActive.id, article.slug, "Article", "GENERIC", now, now);
    await historic.$executeRawUnsafe('INSERT INTO "ArticleRevision" ("id", "articleId", "userId", "title", "slug", "publicationStatus", "visibility", "state", "articleVersionAtSave", "savedAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), article.id, ownerA.id, "Article", article.slug, "DRAFT", "PRIVATE", "DRAFT", 1, now, now);
    await historic.$executeRawUnsafe('INSERT INTO "ArticleRevision" ("id", "articleId", "userId", "title", "slug", "publicationStatus", "visibility", "state", "articleVersionAtSave", "savedAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), article.id, ownerB.id, "Article", article.slug, "DRAFT", "PRIVATE", "DRAFT", 1, now, now);

    await historic.$executeRawUnsafe('INSERT INTO "FoundryPreview" ("id", "worldId", "authorId", "metadataJson", "candidatesJson", "expiresAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)', randomUUID(), worldActive.id, ownerA.id, "{}", "{}", new Date(Date.now() + 60_000).toISOString(), now);
    await historic.$executeRawUnsafe('INSERT INTO "FoundryImportRun" ("id", "worldId", "authorId", "previewId", "idempotencyKey", "requestHash", "outcomesJson", "status", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), worldActive.id, ownerA.id, "preview-1", "key-1", "hash", "{}", "RUNNING", now, now);
    await historic.$executeRawUnsafe('INSERT INTO "WorldTransferImport" ("id", "ownerId", "requestKey", "payloadHash", "payloadJson", "status", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), ownerA.id, "request-1", "hash", "{}", "PENDING", now, now);

    // A player member with no owned content and a grant; membership cascades, audit survives.
    const player = { id: randomUUID(), email: `player-${randomUUID()}@example.invalid` };
    await historic.$executeRawUnsafe('INSERT INTO "User" ("id", "name", "email", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)', player.id, "Player", player.email, "PLAYER", now, now);
    await historic.$executeRawUnsafe('INSERT INTO "WorldMember" ("id", "worldId", "userId", "role", "status", "joinedAt") VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), worldActive.id, player.id, "PLAYER", "ACTIVE", now);
    await historic.$executeRawUnsafe('INSERT INTO "AudiencePolicy" ("id", "worldId", "resourceKind", "resourceId", "mode", "createdById", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), worldActive.id, "articles", article.id, "PLAYER_SNAPSHOT", ownerA.id, now, now);
    const policy = await historic.audiencePolicy.findFirstOrThrow({ where: { worldId: worldActive.id } });
    await historic.$executeRawUnsafe('INSERT INTO "AudienceGrant" ("id", "policyId", "userId", "grantedById", "grantedAt") VALUES (?, ?, ?, ?, ?)', randomUUID(), policy.id, player.id, ownerA.id, now);
    await historic.$executeRawUnsafe('INSERT INTO "AccessAuditEvent" ("id", "worldId", "actorId", "action", "createdAt") VALUES (?, ?, ?, ?, ?)', randomUUID(), worldActive.id, player.id, "TEST_JOIN", now);

    await historic.$disconnect();

    // Apply the P1 migration to the populated database.
    await cp(join(root, "prisma/migrations/20261030120000_installation_admin_p1"), join(migrationsDir, "20261030120000_installation_admin_p1"), { recursive: true });
    runMigrate();

    const after = new PrismaClient();
    try {
      // Singleton inserted by migration.
      assert.equal(await after.installationAdminState.count(), 1);
      const singleton = await after.installationAdminState.findFirstOrThrow();
      assert.equal(singleton.id, 1);

      // Sessions kept their token hashes and gained opaque ids.
      const sessions = await after.authSession.findMany({ orderBy: { createdAt: "asc" } });
      assert.equal(sessions.length, 2);
      for (const session of sessions) {
        assert.ok(session.id, "backfilled session must have opaque id");
        assert.ok([32, 36].includes(session.id.length), "backfilled id is 32 hex chars; new ids are 36-char UUIDs");
      }
      assert.equal((await after.authSession.findUnique({ where: { tokenHash: sessionHash(tokenA) } }))?.userId, ownerA.id);

      // Account lifecycle fields defaulted.
      const upgradedA = await after.user.findUniqueOrThrow({ where: { id: ownerA.id } });
      assert.equal(upgradedA.accountVersion, 0);
      assert.equal(upgradedA.disabledAt, null);
      assert.equal(upgradedA.lastSignInAt, null);

      // Durable records preserved.
      assert.equal(await after.world.count({ where: { ownerId: ownerA.id } }), 2);
      assert.equal(await after.articleRevision.count({ where: { articleId: article.id } }), 2);
      assert.equal(await after.foundryPreview.count({ where: { worldId: worldActive.id } }), 1);
      assert.equal(await after.foundryImportRun.count({ where: { worldId: worldActive.id } }), 1);
      assert.equal(await after.worldTransferImport.count({ where: { ownerId: ownerA.id } }), 1);
      assert.equal(await after.worldMember.count({ where: { userId: player.id } }), 1);
      assert.equal(await after.audienceGrant.count({ where: { userId: player.id } }), 1);
      const audit = await after.accessAuditEvent.findFirstOrThrow({ where: { worldId: worldActive.id } });
      assert.equal(audit.actorId, player.id);

      // RESTRICT behavior after upgrade.
      await assert.rejects(async () => after.user.delete({ where: { id: ownerA.id } }), /Foreign key constraint violated/);
      await assert.rejects(async () => after.user.delete({ where: { id: ownerB.id } }), /Foreign key constraint violated/);

      // Player with no owned content can be deleted; membership cascades, audit survives with null actor.
      await after.user.delete({ where: { id: player.id } });
      assert.equal(await after.user.count({ where: { id: player.id } }), 0);
      assert.equal(await after.worldMember.count({ where: { userId: player.id } }), 0);
      const survivingAudit = await after.accessAuditEvent.findFirstOrThrow({ where: { worldId: worldActive.id } });
      assert.equal(survivingAudit.actorId, null);
    } finally {
      await after.$disconnect();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
