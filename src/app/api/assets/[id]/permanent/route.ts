import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { imageAssetId } from "@/lib/assets";
import { removeAssetFile } from "@/lib/asset-storage";
import { isReferenced, scanAssetReferences } from "@/lib/asset-references";

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

    if (!imageAssetId(id)) {
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

    const references = await scanAssetReferences(asset.worldId, id);

    if (isReferenced(references)) {
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

    // Delete file from disk
    await removeAssetFile(id);

    // Delete database record
    await prisma.imageAsset.delete({
      where: { id },
    });

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
