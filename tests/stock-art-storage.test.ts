import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createStockArtFixture } from "./stock-art-fixture";

test("stock selection materializes once, preserves edits, deduplicates, and rejects withdrawn entries", async () => {
  const fixture = await createStockArtFixture();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "worldforge-stock-storage-"));
  const databasePath = path.join(tempDir, "stock.db");
  const original = {
    databaseUrl: process.env.DATABASE_URL,
    assetDir: process.env.WORLDFORGE_ASSET_DIR,
    stockDir: process.env.WORLDFORGE_STOCK_ART_DIR,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.DATABASE_URL = `file:${databasePath}?connection_limit=1`;
  process.env.WORLDFORGE_ASSET_DIR = path.join(tempDir, "assets");
  process.env.WORLDFORGE_STOCK_ART_DIR = fixture.root;
  await writeFile(databasePath, "");
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], { cwd: process.cwd(), env: process.env, stdio: "pipe" });

  const { prisma } = await import("../src/lib/db");
  const { materializeStockArt } = await import("../src/lib/stock-art-storage");
  const { StockArtError } = await import("../src/lib/stock-art");
  const owner = await prisma.user.create({ data: { name: "Stock test", email: `stock-${randomUUID()}@example.invalid` } });
  const world = await prisma.world.create({ data: { ownerId: owner.id, title: "Stock world", slug: `stock-${randomUUID()}` } });
  const otherWorld = await prisma.world.create({ data: { ownerId: owner.id, title: "Other world", slug: `stock-other-${randomUUID()}` } });
  const raceWorld = await prisma.world.create({ data: { ownerId: owner.id, title: "Race world", slug: `stock-race-${randomUUID()}` } });
  const deletedWorld = await prisma.world.create({ data: { ownerId: owner.id, title: "Deleted world", slug: `stock-deleted-${randomUUID()}`, deletedAt: new Date() } });

  try {
    const first = await materializeStockArt(world.id, "moss-gate", 1);
    assert.equal(first.reused, false);
    assert.equal(first.asset.source, "STOCK");
    assert.equal(first.asset.title, "Moss gate");
    assert.equal(first.asset.alt, "A moss-covered stone gate in a dim forest.");
    assert.equal(first.asset.provenance?.[0].verificationOrigin, "BUNDLED_REVIEW");
    assert.equal(await stat(path.join(process.env.WORLDFORGE_ASSET_DIR!, `${first.asset.id}.webp`)).then(() => true), true);
    const provenanceRows = await prisma.imageAssetProvenance.findMany({ where: { assetId: first.asset.id } });
    assert.equal(provenanceRows.length, 1);
    assert.equal(provenanceRows[0].catalogEntryId, "moss-gate");
    assert.match(provenanceRows[0].manifestDigest, /^[a-f0-9]{64}$/);
    const snapshot = JSON.parse(provenanceRows[0].snapshotJson);
    assert.equal(snapshot.attribution.creditText, "Fixture Artist, CC0 1.0");
    assert.equal(snapshot.rights.evidence.id, "fixture-evidence");

    await prisma.imageAsset.update({ where: { id: first.asset.id }, data: { title: "My own title", alt: "My own description", archived: true } });
    const reused = await materializeStockArt(world.id, "moss-gate", 1);
    assert.equal(reused.reused, true);
    assert.equal(reused.asset.id, first.asset.id);
    assert.equal(reused.asset.title, "My own title");
    assert.equal(reused.asset.alt, "My own description");
    assert.equal(reused.asset.archived, false);
    assert.equal(await prisma.imageAssetProvenance.count({ where: { assetId: first.asset.id } }), 1, "re-selection is idempotent");

    const other = await materializeStockArt(otherWorld.id, "moss-gate", 1);
    assert.notEqual(other.asset.id, first.asset.id);
    assert.notEqual(other.asset.worldId, first.asset.worldId);
    assert.equal(await stat(path.join(process.env.WORLDFORGE_ASSET_DIR!, `${other.asset.id}.webp`)).then(() => true), true);

    const beforeRace = (await readdir(process.env.WORLDFORGE_ASSET_DIR!)).length;
    const raced = await Promise.all([materializeStockArt(raceWorld.id, "moss-gate", 1), materializeStockArt(raceWorld.id, "moss-gate", 1)]);
    assert.equal(raced[0].asset.id, raced[1].asset.id);
    assert.equal(await prisma.imageAsset.count({ where: { worldId: raceWorld.id } }), 1);
    assert.equal(await prisma.imageAssetProvenance.count({ where: { assetId: raced[0].asset.id } }), 1);
    assert.equal((await readdir(process.env.WORLDFORGE_ASSET_DIR!)).length, beforeRace + 1, "the losing file is cleaned up");

    fixture.entry.lifecycle = { state: "retired", reason: "Reviewed replacement pending.", date: "2026-10-22" };
    await fixture.save();
    await assert.rejects(materializeStockArt(world.id, "moss-gate", 1), (error: unknown) => error instanceof StockArtError && error.status === 409);
    await assert.rejects(materializeStockArt(world.id, "moss-gate", 9), (error: unknown) => error instanceof StockArtError && error.status === 404);
    await assert.rejects(materializeStockArt(deletedWorld.id, "moss-gate", 1), (error: unknown) => error instanceof StockArtError && error.status === 404);
    assert.equal(await prisma.imageAsset.count({ where: { worldId: deletedWorld.id } }), 0);

    fixture.entry.lifecycle = { state: "available" };
    fixture.entry.rights.reviewStatus = "pending";
    fixture.entry.rights.evidence.reviewer = "PENDING HUMAN REVIEW";
    await fixture.save();
    const pending = await materializeStockArt(otherWorld.id, "moss-gate", 1);
    assert(pending.asset.provenance?.some(row => row.verificationOrigin === "PENDING_REVIEW"));
    assert.equal(await prisma.imageAssetProvenance.count({ where: { assetId: pending.asset.id, verificationOrigin: "PENDING_REVIEW" } }), 1);
    Object.assign(process.env, { NODE_ENV: "production" });
    await assert.rejects(materializeStockArt(otherWorld.id, "moss-gate", 1), (error: unknown) => error instanceof StockArtError && error.status === 409);
    if (original.nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: original.nodeEnv });
    fixture.manifest.entries[0].files.image = "../escape.webp";
    await fixture.save();
    await assert.rejects(materializeStockArt(world.id, "moss-gate", 1), StockArtError);

    const bytes = await readFile(path.join(process.env.WORLDFORGE_ASSET_DIR!, `${first.asset.id}.webp`));
    assert.equal(bytes.length, fixture.image.length, "catalog WebP bytes are copied without re-encoding");
  } finally {
    await prisma.world.deleteMany({ where: { ownerId: owner.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: owner.id } }).catch(() => {});
    await prisma.$disconnect();
    await fixture.cleanup();
    await rm(tempDir, { recursive: true, force: true });
    if (original.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.databaseUrl;
    if (original.assetDir === undefined) delete process.env.WORLDFORGE_ASSET_DIR; else process.env.WORLDFORGE_ASSET_DIR = original.assetDir;
    if (original.stockDir === undefined) delete process.env.WORLDFORGE_STOCK_ART_DIR; else process.env.WORLDFORGE_STOCK_ART_DIR = original.stockDir;
    if (original.nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: original.nodeEnv });
  }
});
