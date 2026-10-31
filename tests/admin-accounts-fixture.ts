import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { tokenHash } from "../src/lib/passwords";
import type { AdminActor } from "../src/lib/admin-accounts";

let baseDatabase: { dir: string; baseDb: string } | null = null;

async function ensureBaseDatabase(): Promise<{ dir: string; baseDb: string }> {
  if (baseDatabase) return baseDatabase;
  const tmpRoot = process.env.WORLD_TEST_TMP_ROOT || tmpdir();
  const dir = await mkdtemp(join(tmpRoot, "worldforge-admin-base-"));
  const baseDb = join(dir, "base.db");
  const assetDir = join(dir, "assets");
  await mkdir(assetDir, { recursive: true });
  const env = { ...process.env, DATABASE_URL: `file:${baseDb}?connection_limit=1`, WORLDFORGE_ASSET_DIR: assetDir };
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env,
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`Base migration failed: ${result.stderr?.toString() ?? ""}\n${result.stdout?.toString() ?? ""}`);
  }
  baseDatabase = { dir, baseDb };
  return baseDatabase;
}

export async function createIsolatedDatabase(): Promise<{
  db: PrismaClient;
  databaseUrl: string;
  assetDir: string;
  cleanup: () => Promise<void>;
}> {
  const { dir: baseDir, baseDb } = await ensureBaseDatabase();
  const dir = await mkdtemp(join(baseDir, "isolated-"));
  const dbFile = join(dir, `test-${randomUUID()}.db`);
  await cp(baseDb, dbFile);
  const assetDir = join(dir, "assets");
  await mkdir(assetDir, { recursive: true });
  const databaseUrl = `file:${dbFile}?connection_limit=1`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return {
    db,
    databaseUrl,
    assetDir,
    cleanup: async () => {
      await db.$disconnect();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function createAdminActor(
  db: PrismaClient,
  opts: { disabled?: boolean; expired?: boolean; role?: string; expiresInMs?: number } = {},
): Promise<{ user: { id: string; email: string; role: string }; actor: AdminActor; sessionId: string }> {
  const user = await db.user.create({
    data: {
      name: "Admin",
      email: `admin-${randomUUID()}@example.invalid`,
      role: opts.role ?? "ADMIN",
      disabledAt: opts.disabled ? new Date() : null,
    },
  });
  const token = randomBytes(32).toString("base64url");
  let expiresAt: Date;
  if (opts.expiresInMs !== undefined) {
    expiresAt = new Date(Date.now() + opts.expiresInMs);
  } else {
    expiresAt = opts.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60_000);
  }
  const session = await db.authSession.create({
    data: { userId: user.id, tokenHash: tokenHash(token), expiresAt },
  });
  return { user, actor: { type: "WEB_ADMIN", userId: user.id, sessionId: session.id }, sessionId: session.id };
}

export async function createTargetUser(
  db: PrismaClient,
  opts: { role?: string; disabled?: boolean; name?: string } = {},
): Promise<{ id: string; email: string; role: string }> {
  return db.user.create({
    data: {
      name: opts.name ?? "Target",
      email: `target-${randomUUID()}@example.invalid`,
      role: opts.role ?? "AUTHOR",
      disabledAt: opts.disabled ? new Date() : null,
    },
  });
}

export function makeBarrier(): {
  a: { enter: () => void; wait: () => Promise<void> };
  b: { enter: () => void; wait: () => Promise<void> };
  aEntered: () => Promise<void>;
  bEntered: () => Promise<void>;
  releaseA: () => void;
  releaseB: () => void;
} {
  let aEnteredResolve: () => void;
  let bEnteredResolve: () => void;
  let releaseAResolve: () => void;
  let releaseBResolve: () => void;

  const aEntered = new Promise<void>((resolve) => { aEnteredResolve = resolve; });
  const bEntered = new Promise<void>((resolve) => { bEnteredResolve = resolve; });
  const aReleased = new Promise<void>((resolve) => { releaseAResolve = resolve; });
  const bReleased = new Promise<void>((resolve) => { releaseBResolve = resolve; });

  return {
    a: { enter: () => aEnteredResolve(), wait: () => aReleased },
    b: { enter: () => bEnteredResolve(), wait: () => bReleased },
    aEntered: () => aEntered,
    bEntered: () => bEntered,
    releaseA: () => releaseAResolve(),
    releaseB: () => releaseBResolve(),
  };
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

// Re-export the shared cleanup helper so P2.2–P2.6 fixtures can use it alongside this harness.
export { deleteTestUsers } from "./auth-fixture";
