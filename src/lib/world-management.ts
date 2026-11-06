import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { removeAssetFile } from "@/lib/asset-storage";
import { createWorld, type WorldCreationPayload } from "@/lib/world-creation";

export async function archiveWorld(worldId: string, ownerId: string) {
  return prisma.world.updateMany({ where: { id: worldId, ownerId, deletedAt: null }, data: { deletedAt: new Date(), isPublic: false } });
}

export async function duplicateWorldSettings(sourceId: string, ownerId: string, requestId: string) {
  const source = await prisma.world.findFirst({
    where: { id: sourceId, ownerId, deletedAt: null },
    select: { title: true, description: true, system: true },
  });
  if (!source) return { missing: true as const };
  const payload: WorldCreationPayload = {
    title: `${source.title} (settings copy)`.slice(0, 200),
    description: source.description || "",
    system: source.system as WorldCreationPayload["system"],
    requestId,
  };
  const result = await createWorld(ownerId, payload, undefined, `duplicate-settings:${sourceId}`);
  return { ...result, missing: false as const };
}

export class WorldPurgeConflictError extends Error {
  constructor() {
    super("World state changed during purge.");
    this.name = "WorldPurgeConflictError";
  }
}

/** Purge an archived world inside an existing transaction. */
export async function purgeArchivedWorldInTransaction(
  tx: Prisma.TransactionClient,
  worldId: string,
  ownerId: string,
) {
  const world = await tx.world.findFirst({
    where: { id: worldId, ownerId, deletedAt: { not: null } },
    select: { id: true, title: true, assets: { select: { id: true } } },
  });
  if (!world) return null;
  if (world.assets.length) await tx.assetCleanupJob.createMany({
    data: world.assets.map(({ id }) => ({ id: randomUUID(), assetId: id })),
  });
  // Audit rows intentionally restrict ordinary cascading deletion. Purge is
  // the explicit lifecycle operation that removes them in this transaction.
  await tx.accessAuditEvent.deleteMany({ where: { worldId } });
  // Scope the delete to the state that was just checked so a concurrent owner
  // change or restore cannot remove a world we no longer have authority over.
  const deleted = await tx.world.deleteMany({
    where: { id: worldId, ownerId, deletedAt: { not: null } },
  });
  if (deleted.count !== 1) throw new WorldPurgeConflictError();
  return { id: world.id, title: world.title, cleanupQueued: world.assets.length };
}

export async function purgeArchivedWorld(worldId: string, ownerId: string) {
  return prisma.$transaction((tx) => purgeArchivedWorldInTransaction(tx, worldId, ownerId));
}

export async function drainAssetCleanupJobs(limit = 50, removeFile: (assetId: string) => Promise<void> = removeAssetFile) {
  const jobs = await prisma.assetCleanupJob.findMany({ orderBy: { createdAt: "asc" }, take: limit });
  let removed = 0;
  let pending = 0;
  for (const job of jobs) {
    try {
      await removeFile(job.assetId);
      await prisma.assetCleanupJob.deleteMany({ where: { id: job.id } });
      removed++;
    } catch (error) {
      pending++;
      await prisma.assetCleanupJob.updateMany({ where: { id: job.id }, data: {
        attempts: { increment: 1 },
        lastError: error instanceof Error ? error.message.slice(0, 1000) : "Asset cleanup failed",
      } });
    }
  }
  pending = await prisma.assetCleanupJob.count();
  return { removed, pending };
}

