import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("world archive preserves settings, settings duplicate is private and empty, purge cascades with retryable file cleanup", async () => {
  const databaseFilename = `.worldforge-management-${randomUUID()}.db`;
  const databasePath = path.join(process.cwd(), "prisma", databaseFilename);
  const assetDir = await mkdtemp(path.join(os.tmpdir(), "worldforge-assets-"));
  process.env.DATABASE_URL = `file:./${databaseFilename}`;
  process.env.WORLDFORGE_ASSET_DIR = assetDir;
  await writeFile(databasePath, "");
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { encoding: "utf8", env: process.env });
  const { prisma } = await import("../src/lib/db");
  const { archiveWorld, duplicateWorldSettings, drainAssetCleanupJobs, purgeArchivedWorld } = await import("../src/lib/world-management");
  const owner = await prisma.user.create({ data: { name: "Lifecycle test", email: `lifecycle-${randomUUID()}@example.invalid` } });
  const world = await prisma.world.create({ data: {
    ownerId: owner.id, title: "The Quiet Vale", slug: `quiet-vale-${randomUUID()}`,
    description: "Preserved description", genre: "Fantasy", system: "PF_2E", isPublic: true,
    coverImage: "/api/assets/00000000-0000-4000-8000-000000000001/file", appearance: JSON.stringify({ backgroundImage: "/api/assets/00000000-0000-4000-8000-000000000001/file" }),
  } });
  const assetId = "00000000-0000-4000-8000-000000000001";
  await writeFile(path.join(assetDir, `${assetId}.webp`), "asset bytes");
  await prisma.imageAsset.create({ data: { id: assetId, worldId: world.id, title: "Cover", originalName: "cover.webp", byteSize: 11, width: 1, height: 1, sha256: "a".repeat(64) } });
  await prisma.article.create({ data: { worldId: world.id, title: "An article", slug: "an-article", template: "GENERIC" } });
  try {
    assert.equal((await purgeArchivedWorld(world.id, owner.id)), null, "active worlds cannot be permanently deleted");
    assert.equal((await archiveWorld(world.id, owner.id)).count, 1);
    const archived = await prisma.world.findUniqueOrThrow({ where: { id: world.id } });
    assert.ok(archived.deletedAt);
    assert.equal(archived.isPublic, false);
    assert.equal(archived.title, "The Quiet Vale");
    assert.equal(archived.description, "Preserved description");
    assert.equal(archived.coverImage, world.coverImage);
    assert.equal(archived.appearance, world.appearance);

    const duplicate = await duplicateWorldSettings(world.id, owner.id, randomUUID());
    assert.equal(duplicate.missing, true, "archived sources are not duplicable");
    await prisma.world.update({ where: { id: world.id }, data: { deletedAt: null } });
    const duplicateRequestId = randomUUID();
    const copied = await duplicateWorldSettings(world.id, owner.id, duplicateRequestId);
    assert.equal(copied.missing, false);
    if (!copied.missing) {
      assert.equal(copied.created, true);
      assert.equal(copied.world.title, "The Quiet Vale (settings copy)");
      assert.equal(copied.world.system, "PF_2E");
      assert.equal(copied.world.isPublic, false);
      assert.equal(copied.world.coverImage, null);
      assert.equal(copied.world.bannerImage, null);
      assert.equal(copied.world.appearance, null);
      assert.equal(await prisma.article.count({ where: { worldId: copied.world.id } }), 0);
      assert.equal(await prisma.imageAsset.count({ where: { worldId: copied.world.id } }), 0);
      const retry = await duplicateWorldSettings(world.id, owner.id, duplicateRequestId);
      assert.equal(retry.missing, false);
      if (!retry.missing) {
        assert.equal(retry.created, false);
        assert.equal(retry.world.id, copied.world.id);
      }
      await prisma.world.update({ where: { id: world.id }, data: { title: "Changed source" } });
      const conflictingRetry = await duplicateWorldSettings(world.id, owner.id, duplicateRequestId);
      assert.equal(conflictingRetry.missing, false);
      if (!conflictingRetry.missing) {
        assert.equal(conflictingRetry.conflict, false, "retry reopens original copy even after editing source");
        assert.equal(conflictingRetry.world.id, copied.world.id);
      }
      const otherSource = await prisma.world.create({ data: { ownerId: owner.id, title: "Changed source", slug: `other-${randomUUID()}`, system: "PF_2E" } });
      const wrongSource = await duplicateWorldSettings(otherSource.id, owner.id, duplicateRequestId);
      if (!wrongSource.missing) assert.equal(wrongSource.conflict, true, "request identity includes source and operation");
      const { createWorld } = await import("../src/lib/world-creation");
      const normalCreation = await createWorld(owner.id, { title: copied.world.title, description: copied.world.description || "", system: "PF_2E", requestId: duplicateRequestId });
      assert.equal(normalCreation.conflict, true, "a settings-copy request cannot collide with ordinary creation");
    }

    await prisma.accessAuditEvent.create({ data: { worldId: world.id, actorId: owner.id, action: "TEST_AUDIT" } });
    await archiveWorld(world.id, owner.id);
    const purged = await purgeArchivedWorld(world.id, owner.id);
    assert.equal(purged?.cleanupQueued, 1);
    assert.equal(await prisma.world.findUnique({ where: { id: world.id } }), null);
    assert.equal(await prisma.article.count({ where: { worldId: world.id } }), 0);
    assert.equal(await prisma.imageAsset.count({ where: { worldId: world.id } }), 0);
    const concurrentCleanup = await Promise.all([drainAssetCleanupJobs(), drainAssetCleanupJobs()]);
    assert.ok(concurrentCleanup.every(result => result.pending === 0));
    await assert.rejects(readFile(path.join(assetDir, `${assetId}.webp`)));
    assert.equal(await prisma.assetCleanupJob.count(), 0);
  } finally {
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
    await rm(databasePath, { force: true });
    await rm(`${databasePath}-journal`, { force: true });
    await rm(assetDir, { recursive: true, force: true });
  }
});
