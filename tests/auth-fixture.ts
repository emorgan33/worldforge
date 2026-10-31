import { randomBytes, createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { SESSION_COOKIE } from "../src/lib/auth-constants";

function isWithin(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function assertIsolatedTestEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const assetDir = process.env.WORLDFORGE_ASSET_DIR;
  const databasePath = databaseUrl?.match(/^file:(.*?)(?:\?.*)?$/)?.[1];
  if (!databasePath || !path.isAbsolute(databasePath) || !isWithin(os.tmpdir(), path.resolve(databasePath))) {
    throw new Error("HTTP integration fixtures require DATABASE_URL to point to an absolute SQLite file under the system temporary directory.");
  }
  if (!assetDir || !path.isAbsolute(assetDir) || !isWithin(os.tmpdir(), path.resolve(assetDir))) {
    throw new Error("HTTP integration fixtures require WORLDFORGE_ASSET_DIR to point under the system temporary directory.");
  }
  if (process.env.WORLD_CREATION_TEST_DATABASE_URL !== databaseUrl) {
    throw new Error("Set WORLD_CREATION_TEST_DATABASE_URL to the same isolated SQLite URL as DATABASE_URL.");
  }
}

export async function deleteTestUsers(db: PrismaClient, ...userIds: string[]) {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return;
  await db.$transaction([
    db.worldTransferImport.deleteMany({ where: { ownerId: { in: ids } } }),
    db.foundryImportRun.deleteMany({ where: { authorId: { in: ids } } }),
    db.foundryPreview.deleteMany({ where: { authorId: { in: ids } } }),
    db.articleRevision.deleteMany({ where: { userId: { in: ids } } }),
    db.world.deleteMany({ where: { ownerId: { in: ids } } }),
    db.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

export async function authorFetch(db: PrismaClient, userId: string, origin: string) {
  assertIsolatedTestEnvironment();
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000 * 30) } });
  return (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set("Cookie", `${SESSION_COOKIE}=${token}`); if (!headers.has("Origin")) headers.set("Origin", origin);
    return fetch(input, { ...init, headers });
  };
}
