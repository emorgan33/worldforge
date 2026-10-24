import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAssetId } from "@/lib/assets";
import { isReferenced, scanAssetReferences } from "@/lib/asset-references";
import { randomUUID } from "node:crypto";
import { drainAssetCleanupJobs } from "@/lib/world-management";

export interface DeletionResult {
  success: boolean;
  deleted: boolean;
  referenced: boolean;
  references?: {
    worldCover: boolean;
    worldBanner: boolean;
    worldBackground: boolean;
    categoryCount: number;
    articleCount: number;
  };
}

/**
 * DELETE /api/assets/[id]/permanent
 * Permanently deletes an asset and its file.
 * Requires that the asset is not actively referenced in any content.
 */
export const DELETE = withAuthor(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!isAssetId(id)) {
      return NextResponse.json({ error: "Invalid image ID" }, { status: 400 });
    }

    const asset = await prisma.imageAsset.findUnique({
      where: { id },
      select: { id: true, worldId: true, archived: true, world: { select: { ownerId: true } } },
    });

    if (!asset) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const user = await import("@/lib/auth").then(m => m.sessionUser());
    if (user?.id !== asset.world.ownerId) {
      throw new AccessError("You do not have access to this image", 403);
    }

    const deletion = await prisma.$transaction(async tx => {
      const references = await scanAssetReferences(asset.worldId, id, tx);
      if (isReferenced(references)) return { references, deleted: false };
      await tx.assetCleanupJob.upsert({
        where: { assetId: id },
        create: { id: randomUUID(), assetId: id },
        update: {},
      });
      await tx.imageAsset.delete({ where: { id } });
      return { references, deleted: true };
    });

    if (!deletion.deleted) {
      const references = deletion.references;
      return NextResponse.json({
        success: false,
        deleted: false,
        referenced: true,
        references: {
          worldCover: references.worldCover,
          worldBanner: references.worldBanner,
          worldBackground: references.worldBackground,
          categoryCount: references.categories.length,
          articleCount: references.articles.length,
        },
      } satisfies DeletionResult);
    }

    // Attempt immediate unlink after the durable intent has committed. The
    // drainer keeps failures queued and records their error for a later retry.
    await drainAssetCleanupJobs();

    return NextResponse.json({
      success: true,
      deleted: true,
      referenced: false,
    } satisfies DeletionResult);
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to permanently delete asset:", error);
    return NextResponse.json({ error: "Failed to permanently delete image" }, { status: 500 });
  }
});
