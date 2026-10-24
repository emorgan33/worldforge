import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("stock advisories parse, restrict all installed copies by catalog identity, and can be cleared", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "worldforge-advisories-"));
  const databasePath = path.join(tempDir, "advisories.db");
  const original = {
    databaseUrl: process.env.DATABASE_URL,
    assetDir: process.env.WORLDFORGE_ASSET_DIR,
  };
  process.env.DATABASE_URL = `file:${databasePath}?connection_limit=1`;
  process.env.WORLDFORGE_ASSET_DIR = path.join(tempDir, "assets");
  await writeFile(databasePath, "");
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], { cwd: process.cwd(), env: process.env, stdio: "pipe" });

  const { prisma } = await import("../src/lib/db");
  const { parseStockAdvisories, applyStockAdvisories, readStockAdvisoryFile } = await import("../src/lib/stock-advisories");

  try {
    const parsed = parseStockAdvisories({
      advisories: [
        { catalogEntryId: "moonlit-keep", version: 2, action: "restrict", reason: "Rights review pending", date: "2026-10-23" },
        { catalogEntryId: "moss-gate", version: 1, action: "clear" },
      ],
    });
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.advisories.length, 2);
    assert.equal(parsed.advisories[0].reason, "Rights review pending");
    assert.equal(parsed.advisories[1].date, new Date().toISOString().slice(0, 10));

    const rejected = parseStockAdvisories({
      advisories: [
        { catalogEntryId: "NOT VALID", version: 1, action: "restrict", reason: "x" },
        { catalogEntryId: "ok-id", version: 0, action: "restrict", reason: "x" },
        { catalogEntryId: "ok-id", version: 1, action: "nope" },
        { catalogEntryId: "ok-id", version: 1, action: "restrict" },
      ],
    });
    assert.equal(rejected.advisories.length, 0);
    assert.equal(rejected.errors.length, 4);
    assert.ok(rejected.errors.every(error => error.length > 0));

    assert.deepEqual(await readStockAdvisoryFile(path.join(tempDir, "missing.json")), { advisories: [], errors: [] });

    const owner = await prisma.user.create({ data: { name: "Advisory test", email: `adv-${randomUUID()}@example.invalid` } });
    const worldA = await prisma.world.create({ data: { ownerId: owner.id, title: "A", slug: `adv-a-${randomUUID()}` } });
    const worldB = await prisma.world.create({ data: { ownerId: owner.id, title: "B", slug: `adv-b-${randomUUID()}` } });
    const affected = randomUUID();
    const unaffected = randomUUID();
    await prisma.imageAsset.createMany({ data: [
      { id: affected, worldId: worldA.id, title: "Keep copy", originalName: "keep.webp", mimeType: "image/webp", byteSize: 1, width: 1, height: 1, sha256: "a".repeat(64), source: "STOCK" },
      { id: unaffected, worldId: worldB.id, title: "Other copy", originalName: "other.webp", mimeType: "image/webp", byteSize: 1, width: 1, height: 1, sha256: "b".repeat(64), source: "STOCK" },
    ] });
    await prisma.imageAssetProvenance.createMany({ data: [
      { assetId: affected, catalogEntryId: "moonlit-keep", catalogVersion: 2, manifestDigest: "c".repeat(64), snapshotJson: "{}", verificationOrigin: "BUNDLED_REVIEW" },
      { assetId: unaffected, catalogEntryId: "moss-gate", catalogVersion: 1, manifestDigest: "d".repeat(64), snapshotJson: "{}", verificationOrigin: "BUNDLED_REVIEW" },
    ] });

    const applied = await applyStockAdvisories([
      { catalogEntryId: "moonlit-keep", version: 2, action: "restrict", reason: "Rights review pending", date: "2026-10-23" },
      { catalogEntryId: "missing-entry", version: 1, action: "restrict", reason: "n/a" },
    ]);
    assert.equal(applied.restricted, 1);
    assert.deepEqual(applied.unmatched, ["missing-entry@1"]);
    assert.deepEqual(applied.errors, []);
    const restricted = await prisma.imageAsset.findUniqueOrThrow({ where: { id: affected } });
    assert.equal(restricted.displayRestricted, true);
    assert.equal(restricted.restrictionReason, "Rights review pending");
    assert.equal(restricted.restrictionDate?.toISOString().slice(0, 10), "2026-10-23");
    assert.equal((await prisma.imageAsset.findUniqueOrThrow({ where: { id: unaffected } })).displayRestricted, false);
    assert.equal(await prisma.imageAssetProvenance.count({ where: { assetId: affected } }), 1, "restriction preserves provenance");

    const cleared = await applyStockAdvisories([{ catalogEntryId: "moonlit-keep", version: 2, action: "clear" }]);
    assert.equal(cleared.cleared, 1);
    const restored = await prisma.imageAsset.findUniqueOrThrow({ where: { id: affected } });
    assert.equal(restored.displayRestricted, false);
    assert.equal(restored.restrictionReason, null);
    assert.equal(restored.restrictionDate, null);
  } finally {
    await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
    if (original.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.databaseUrl;
    if (original.assetDir === undefined) delete process.env.WORLDFORGE_ASSET_DIR; else process.env.WORLDFORGE_ASSET_DIR = original.assetDir;
  }
});
