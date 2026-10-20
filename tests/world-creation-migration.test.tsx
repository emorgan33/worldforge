import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test("creation migration upgrades populated worlds and preserves multiple null request keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worldforge-migration-"));
  const migrationsDir = join(dir, "migrations");
  const schemaPath = join(dir, "schema.prisma");
  const dbPath = join(dir, "upgrade.sqlite");
  const databaseUrl = `file:${dbPath}`;
  const root = process.cwd();
  try {
    await mkdir(migrationsDir);
    await cp(join(root, "prisma/schema.prisma"), schemaPath);
    const migrationNames = ["20261016163659_table_access_foundation", "20261019120000_foundry_import"];
    for (const name of migrationNames) await cp(join(root, "prisma/migrations", name), join(migrationsDir, name), { recursive: true });
    await writeFile(join(migrationsDir, "migration_lock.toml"), 'provider = "sqlite"\n');
    const runMigrate = () => execFileSync(process.execPath, [join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", schemaPath], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    await writeFile(dbPath, "");
    runMigrate();
    process.env.DATABASE_URL = databaseUrl;
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const owner = { id: randomUUID(), email: `migration-${randomUUID()}@example.invalid` };
    const prior = { id: randomUUID(), slug: `existing-${randomUUID()}` };
    const now = new Date().toISOString();
    await db.$executeRawUnsafe('INSERT INTO "User" ("id", "name", "email", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)', owner.id, "Existing author", owner.email, "AUTHOR", now, now);
    await db.$executeRawUnsafe('INSERT INTO "World" ("id", "slug", "title", "ownerId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)', prior.id, prior.slug, "Existing world", owner.id, now, now);
    await db.$disconnect();
    // Upgrade the populated historical database to the current schema before
    // querying it with the current generated Prisma client.
    for (const name of (await readdir(join(root, "prisma/migrations"))).filter(name => /^\d/.test(name) && !migrationNames.includes(name)).sort()) {
      await cp(join(root, "prisma/migrations", name), join(migrationsDir, name), { recursive: true });
    }
    runMigrate();
    const after = new PrismaClient();
    try {
      const restored = await after.world.findUniqueOrThrow({ where: { id: prior.id } });
      assert.equal(restored.title, "Existing world");
      assert.equal(restored.creationRequestId, null);
      await after.world.create({ data: { ownerId: owner.id, title: "Null key one", slug: `null-one-${randomUUID()}` } });
      await after.world.create({ data: { ownerId: owner.id, title: "Null key two", slug: `null-two-${randomUUID()}` } });
    } finally {
      await after.user.delete({ where: { id: owner.id } });
      await after.$disconnect();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
