import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { removeAssetFile, assetDirectory } from "@/lib/asset-storage";
import { referencedAssetIds } from "@/lib/asset-references";
import { readdir } from "node:fs/promises";

export interface CleanupResult {
  success: boolean;
  deletedAssets: string[];
  orphanedFiles: string[];
  errors: string[];
}

/**
 * DELETE /api/worlds/[id]/cleanup
 * Cleans up orphaned asset files for a world.
 * Removes archived assets whose files still exist but records don't.
 */
export const DELETE = withAuthor(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const errors: string[] = [];
  const orphanedFiles: string[] = [];
  const deletedAssets: string[] = [];

  try {
    const { id: worldId } = await params;

    const world = await prisma.world.findUnique({
      where: { id: worldId },
      select: { id: true, ownerId: true },
    });

    if (!world) return NextResponse.json({ error: "World not found" }, { status: 404 });

    const user = await import("@/lib/auth").then(m => m.sessionUser());
    if (user?.id !== world.ownerId) throw new AccessError("You do not have access to this world", 403);

    // Get all assets for this world from database
    const dbAssets = await prisma.imageAsset.findMany({
      where: { worldId },
      select: { id: true, archived: true },
    });
    const dbAssetIds = new Set(dbAssets.map(a => a.id));
    const archivedAssetIds = new Set(dbAssets.filter(a => a.archived).map(a => a.id));

    // Find every referenced asset ID using the shared exhaustive scan so
    // portraits, parsed article bodies and category illustrations are honored.
    const referencedIds = await referencedAssetIds(worldId);

    // Find orphaned archived assets (in DB but no longer referenced)
    const orphanedDbAssets = dbAssets.filter(a => 
      archivedAssetIds.has(a.id) && !referencedIds.has(a.id)
    );

    // Delete orphaned archived assets from database and files
    for (const asset of orphanedDbAssets) {
      try {
        await removeAssetFile(asset.id);
        await prisma.imageAsset.delete({ where: { id: asset.id } });
        deletedAssets.push(asset.id);
      } catch (e) {
        errors.push(`Failed to delete archived asset ${asset.id}: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }

    // Find orphaned files (on disk but not in database for this world)
    try {
      const files = await readdir(assetDirectory());
      const webpFiles = files.filter(f => f.endsWith(".webp")).map(f => f.replace(".webp", ""));
      
      for (const fileId of webpFiles) {
        if (!dbAssetIds.has(fileId)) {
          try {
            await removeAssetFile(fileId);
            orphanedFiles.push(fileId);
          } catch (e) {
            errors.push(`Failed to delete orphaned file ${fileId}: ${e instanceof Error ? e.message : "Unknown error"}`);
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code !== "ENOENT") {
        errors.push(`Failed to read asset directory: ${e.message}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      deletedAssets,
      orphanedFiles,
      errors,
    } satisfies CleanupResult);
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Cleanup failed:", error);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
});
