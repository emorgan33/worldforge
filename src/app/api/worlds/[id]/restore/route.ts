import { NextResponse } from "next/server";
import { withAuthor, sessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// POST /api/worlds/[id]/restore - Restore a soft-deleted world
export const POST = withAuthor(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id: worldId } = await params;
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to restore your world." }, { status: 401 });

  const deletedWorld = await prisma.world.findUnique({
    where: { id: worldId, ownerId: user.id, deletedAt: { not: null } },
    select: { id: true, title: true, slug: true },
  });

  if (!deletedWorld) {
    return NextResponse.json({ error: "World not found or not deleted." }, { status: 404 });
  }

  try {
    await prisma.world.updateMany({
      where: { id: worldId, ownerId: user.id, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        isPublic: false,
      },
    });

    return NextResponse.json({
      success: true,
      message: "World restored successfully.",
      worldId: deletedWorld.id,
      title: deletedWorld.title,
    });
  } catch (error) {
    console.error("Failed to restore world:", error);
    return NextResponse.json({ error: "Failed to restore world" }, { status: 500 });
  }
});
