import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { imageAssetId } from "@/lib/assets";

/**
 * DELETE /api/assets/[id]
 * Archives an asset (soft delete). Use /api/assets/[id]/permanent for hard delete.
 */
export const DELETE = withAuthor(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
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

    // Archive instead of hard delete to preserve data integrity
    await prisma.imageAsset.update({
      where: { id },
      data: { archived: true },
    });

    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to archive asset:", error);
    return NextResponse.json({ error: "Failed to archive image" }, { status: 500 });
  }
});