import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { test } from "node:test";
import { assetDirectory } from "../src/lib/asset-storage";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("world cleanup leaves shared assets and staged files untouched", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const ownerA = await db.user.create({ data: { name: "Cleanup owner A", email: `cleanup-a-${suffix}@example.invalid` } });
  const ownerB = await db.user.create({ data: { name: "Cleanup owner B", email: `cleanup-b-${suffix}@example.invalid` } });
  const worldA = await db.world.create({ data: { ownerId: ownerA.id, title: "Cleanup A", slug: `cleanup-a-${suffix}` } });
  const worldA2 = await db.world.create({ data: { ownerId: ownerA.id, title: "Cleanup A2", slug: `cleanup-a2-${suffix}` } });
  const worldB = await db.world.create({ data: { ownerId: ownerB.id, title: "Cleanup B", slug: `cleanup-b-${suffix}` } });
  const assetIds = [randomUUID(), randomUUID(), randomUUID()];
  const stagedId = randomUUID();
  const fileBytes = new Map([[assetIds[0], Buffer.from("owner-a-file")], [assetIds[1], Buffer.from("owner-a2-file")], [assetIds[2], Buffer.from("owner-b-file")], [stagedId, Buffer.from("staged-before-metadata")] ]);
  const directory = assetDirectory();
  await mkdir(directory, { recursive: true });
  for (const [id, bytes] of fileBytes) await writeFile(path.join(directory, `${id}.webp`), bytes, { flag: "wx" });
  await db.imageAsset.create({ data: { id: assetIds[0], worldId: worldA.id, title: "A", originalName: "a.webp", byteSize: 12, width: 1, height: 1, sha256: "a".repeat(64), archived: true } });
  await db.imageAsset.create({ data: { id: assetIds[1], worldId: worldA2.id, title: "A2", originalName: "a2.webp", byteSize: 13, width: 1, height: 1, sha256: "b".repeat(64) } });
  await db.imageAsset.create({ data: { id: assetIds[2], worldId: worldB.id, title: "B", originalName: "b.webp", byteSize: 14, width: 1, height: 1, sha256: "c".repeat(64) } });
  context.after(async () => {
    await Promise.all([...fileBytes.keys()].map(id => rm(path.join(directory, `${id}.webp`), { force: true })));
    await db.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } });
    await db.$disconnect();
  });

  const unauthorized = await fetch(`${origin}/api/worlds/${worldA.id}/cleanup`, { method: "DELETE" });
  assert.equal(unauthorized.status, 401);
  const otherOwner = await authorFetch(db, ownerB.id, origin!);
  const denied = await otherOwner(`${origin}/api/worlds/${worldA.id}/cleanup`, { method: "DELETE" });
  assert.equal(denied.status, 404);
  const owner = await authorFetch(db, ownerA.id, origin!);
  const response = await owner(`${origin}/api/worlds/${worldA.id}/cleanup`, { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, deletedAssets: [], orphanedFiles: [], errors: [] });
  for (const id of assetIds) assert.ok(await db.imageAsset.findUnique({ where: { id } }), `${id} metadata must remain`);
  for (const [id, bytes] of fileBytes) assert.deepEqual(await readFile(path.join(directory, `${id}.webp`)), bytes, `${id} bytes must remain`);
});
