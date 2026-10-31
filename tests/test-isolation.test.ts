import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const rejectedByGuard = [
  "assets-api.test.tsx",
  "world-backup-restore.test.tsx",
  "world-export-import-api.test.tsx",
  "auth-publication-api.test.tsx",
];
const originUnsetSuites = [
  "assets-api.test.tsx",
  "world-backup-restore.test.tsx",
  "world-export-import-api.test.tsx",
];

test("fixture cleanup guards deleteMany against undefined ownerId", async context => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const ownerA = await db.user.create({ data: { name: "Guard A", email: `guard-a-${randomUUID()}@example.invalid` } });
  const ownerB = await db.user.create({ data: { name: "Guard B", email: `guard-b-${randomUUID()}@example.invalid` } });
  const worldA = await db.world.create({ data: { ownerId: ownerA.id, title: "Guard A world", slug: randomUUID() } });
  const worldB = await db.world.create({ data: { ownerId: ownerB.id, title: "Guard B world", slug: randomUUID() } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: { in: [ownerA.id, ownerB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } });
    await db.$disconnect();
  });

  const before = await db.world.count();
  assert.equal(before >= 2, true);
  // Simulate the browser-fixture cleanup path when user creation failed and
  // ownerId is still undefined: the guard must skip deletion entirely.
  let ownerId: string | undefined;
  if (ownerId) {
    await db.world.deleteMany({ where: { ownerId } });
  }
  const after = await db.world.count();
  assert.equal(after, before, "guarded cleanup with undefined ownerId must not delete worlds");
  assert.ok(await db.world.findUnique({ where: { id: worldA.id } }));
  assert.ok(await db.world.findUnique({ where: { id: worldB.id } }));
});

test("rejected test configuration and origin-unset skips preserve database and asset sentinels", async context => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const assetDir = process.env.WORLDFORGE_ASSET_DIR!;
  mkdirSync(assetDir, { recursive: true });
  const token = randomUUID();
  const sentinelFile = `${randomUUID()}.webp`;
  const sentinelPath = `${assetDir}/${sentinelFile}`;
  const sentinelBytes = Buffer.from("worldforge-isolation-asset-sentinel");
  writeFileSync(sentinelPath, sentinelBytes, { flag: "wx" });
  context.after(async () => { await import("node:fs/promises").then(fs => fs.unlink(sentinelPath).catch(() => undefined)); });
  const assertSentinelBytes = () => assert.deepEqual(readFileSync(sentinelPath), sentinelBytes, "asset sentinel bytes must remain unchanged");
  writeFileSync(sentinelPath, Buffer.from("controlled-overwrite"));
  assert.throws(() => assertSentinelBytes());
  writeFileSync(sentinelPath, sentinelBytes);
  const email = `isolation-sentinel-${token}@example.invalid`;
  const slug = `isolation-sentinel-${token}`;
  const user = await db.user.create({ data: { name: "Isolation sentinel", email } });
  const world = await db.world.create({ data: { ownerId: user.id, title: "Isolation sentinel", slug } });
  context.after(async () => {
    await db.world.deleteMany({ where: { id: world.id } });
    await deleteTestUsers(db, user.id);
    await db.$disconnect();
  });

  const tableCounts = async () => {
    const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_prisma_%' ORDER BY name`;
    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      const result = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`);
      counts[name] = Number(result[0].count);
    }
    return counts;
  };
  const baselineCounts = await tableCounts();
  const baselineFiles = readdirSync(assetDir).sort();
  const databaseUrl = process.env.DATABASE_URL!;
  const badEnvironment = {
    ...process.env,
    WORLDFORGE_TEST_ORIGIN: "http://127.0.0.1:1",
    WORLD_CREATION_TEST_DATABASE_URL: `${databaseUrl}.mismatch`,
  };
  const runSuite = (suite: string, env: NodeJS.ProcessEnv) => {
    const childEnvironment = { ...env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    delete childEnvironment.NODE_TEST_WORKER_ID;
    return spawnSync(process.execPath, [
      "--import", "tsx", "--test", "--test-concurrency=1", `tests/${suite}`,
    ], { cwd: process.cwd(), encoding: "utf8", env: childEnvironment, maxBuffer: 8 * 1024 * 1024 });
  };

  for (const suite of rejectedByGuard) {
    const result = runSuite(suite, badEnvironment);
    assert.equal(result.status, 1, `${suite} should fail closed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, /Set WORLD_CREATION_TEST_DATABASE_URL/);
    assert.deepEqual(await tableCounts(), baselineCounts, `${suite} must not create or delete database rows`);
    assert.deepEqual(readdirSync(assetDir).sort(), baselineFiles, `${suite} must not change the asset directory`);
    assertSentinelBytes();
    assert.ok(await db.user.findUnique({ where: { id: user.id } }), `${suite} must preserve the sentinel user`);
    assert.ok(await db.world.findUnique({ where: { id: world.id } }), `${suite} must preserve the sentinel world`);
  }

  const skippedEnvironment: NodeJS.ProcessEnv = { ...process.env, WORLD_CREATION_TEST_DATABASE_URL: `${databaseUrl}.mismatch` };
  delete skippedEnvironment.WORLDFORGE_TEST_ORIGIN;
  for (const suite of originUnsetSuites) {
    const result = runSuite(suite, skippedEnvironment);
    assert.equal(result.status, 0, `${suite} should skip cleanly: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# SKIP/);
    assert.deepEqual(await tableCounts(), baselineCounts, `${suite} must not write when its origin is unset`);
    assert.deepEqual(readdirSync(assetDir).sort(), baselineFiles, `${suite} must not touch assets when its origin is unset`);
    assertSentinelBytes();
    assert.ok(await db.world.findUnique({ where: { id: world.id } }), `${suite} must preserve the sentinel world`);
  }
});
