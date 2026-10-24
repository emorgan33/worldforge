import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

test("pending-review migration preserves evidence and imported claims while correcting old review labels", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "worldforge-review-migration-"));
  const db = new PrismaClient({ datasourceUrl: `file:${path.join(root, "test.db")}` });
  try {
    await db.$executeRawUnsafe('CREATE TABLE "ImageAsset" ("id" TEXT PRIMARY KEY, "worldId" TEXT NOT NULL)');
    await db.$executeRawUnsafe("INSERT INTO ImageAsset (id, worldId) VALUES ('asset', 'world')");
    for (const migration of ["20261023150000_stock_art_provenance"]) {
      const sql = await readFile(path.join("prisma/migrations", migration, "migration.sql"), "utf8");
      for (const statement of sql.replace(/--[^\n]*/g, "").split(";").filter(statement => statement.trim())) await db.$executeRawUnsafe(statement);
    }
    const approved = JSON.stringify({ rights: { reviewStatus: "approved", evidence: { reviewer: "Fixture Reviewer", reviewedAt: "2026-10-23" } } });
    for (const [id, origin, snapshot] of [
      ["pending", "BUNDLED_REVIEW", JSON.stringify({ rights: { evidence: { reviewer: "PENDING HUMAN REVIEW" } } })],
      ["approved", "BUNDLED_REVIEW", approved],
      ["invalid", "BUNDLED_REVIEW", "not JSON"],
      ["malformed-reviewer", "BUNDLED_REVIEW", JSON.stringify({ rights: { reviewStatus: "approved", evidence: { reviewer: 123, reviewedAt: "2026-10-23" } } })],
      ["imported", "IMPORTED_DECLARATION", approved],
    ]) {
      await db.$executeRawUnsafe('INSERT INTO "ImageAssetProvenance" (id, assetId, catalogEntryId, catalogVersion, manifestDigest, snapshotJson, verificationOrigin) VALUES (?, ?, ?, ?, ?, ?, ?)', id, "asset", id, 1, "digest", snapshot, origin);
    }
    const sql = await readFile("prisma/migrations/20261023200000_pending_stock_review/migration.sql", "utf8");
    for (const statement of sql.replace(/--[^\n]*/g, "").split(";").filter(statement => statement.trim())) await db.$executeRawUnsafe(statement);
    const rows = await db.imageAssetProvenance.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(rows.map(row => [row.id, row.verificationOrigin]), [["approved", "BUNDLED_REVIEW"], ["imported", "IMPORTED_DECLARATION"], ["invalid", "PENDING_REVIEW"], ["malformed-reviewer", "PENDING_REVIEW"], ["pending", "PENDING_REVIEW"]]);
    assert.equal(rows.find(row => row.id === "invalid")?.snapshotJson, "not JSON");
    await db.$executeRawUnsafe('INSERT INTO "ImageAssetProvenance" (id, assetId, catalogEntryId, catalogVersion, manifestDigest, snapshotJson) VALUES (?, ?, ?, ?, ?, ?)', "default", "asset", "default", 1, "digest", "{}");
    assert.equal((await db.imageAssetProvenance.findUniqueOrThrow({ where: { id: "default" } })).verificationOrigin, "PENDING_REVIEW");
    assert.deepEqual(await db.$queryRawUnsafe("PRAGMA foreign_key_check"), []);
  } finally {
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
