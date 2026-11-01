import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import * as ts from "typescript";
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

async function worldDeleteManyGuarded(filePath: string): Promise<boolean> {
  const sourceText = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  let guarded = true;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sourceFile);
      if (exprText === "db.world.deleteMany") {
        let parent: ts.Node | undefined = node.parent;
        let insideOwnerIdIf = false;
        while (parent) {
          if (ts.isIfStatement(parent)) {
            const cond = parent.expression.getText(sourceFile);
            if (/\bownerId\b/.test(cond)) {
              insideOwnerIdIf = true;
              break;
            }
          }
          parent = parent.parent;
        }
        if (!insideOwnerIdIf) guarded = false;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return guarded;
}

test("browser fixture cleanup guards db.world.deleteMany with ownerId", async () => {
  const files = [
    "tests/browser/article-saves.spec.ts",
    "tests/browser/interactive-maps.spec.ts",
    "tests/browser/variables.spec.ts",
    "tests/browser/workspace-transitions.spec.ts",
  ];
  for (const file of files) {
    const path = join(process.cwd(), file);
    assert.equal(await worldDeleteManyGuarded(path), true, `${file} must guard db.world.deleteMany inside if (ownerId)`);
  }
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
