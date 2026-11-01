import { randomUUID } from "node:crypto";
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

export async function purgeArchivedWorld(worldId: string, ownerId: string) {
  return prisma.$transaction(async (tx) => {
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
    // Any unexpected relation failure aborts the transaction and preserves jobs.
    await tx.world.delete({ where: { id: worldId } });
    return { id: world.id, title: world.title, cleanupQueued: world.assets.length };
  });
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

