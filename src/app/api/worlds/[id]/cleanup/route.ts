import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export interface CleanupResult {
  success: boolean;
  deletedAssets: string[];
  orphanedFiles: string[];
  errors: string[];
}

/**
 * DELETE /api/worlds/[id]/cleanup
 * Legacy cleanup endpoint retained for compatibility. Physical asset cleanup
 * is disabled here because files share a directory across worlds and this
 * route cannot establish ownership of unregistered files.
 */
export const DELETE = withAuthor({ target: "world-param" }, async (_request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
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

    if (user.id !== world.ownerId) throw new AccessError("You do not have access to this world", 403);

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
