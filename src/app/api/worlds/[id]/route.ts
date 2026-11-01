import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { archiveWorld } from "@/lib/world-management";

// DELETE /api/worlds/[id] - Soft delete a world (archive it)
export const DELETE = withAuthor({ target: "world-param" }, async (_request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
  const { id: worldId } = await params;
  
  try {
    const result = await archiveWorld(worldId, user.id);
    if (!result.count) return NextResponse.json({ error: "World not found or already archived." }, { status: 404 });
    return NextResponse.json({ success: true, message: "World archived successfully." });
  } catch (error) {
    console.error("Failed to archive world:", error);
    return NextResponse.json({ error: "Failed to archive world" }, { status: 500 });
  }
});
