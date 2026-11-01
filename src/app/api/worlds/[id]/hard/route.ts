import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { drainAssetCleanupJobs, purgeArchivedWorld } from "@/lib/world-management";

// Permanent removal is limited to an already archived world.
export const DELETE = withAuthor({ target: "world-param", archived: true }, async (_request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
  try {
    const { id } = await params;
    const deleted = await purgeArchivedWorld(id, user.id);
    if (!deleted) return NextResponse.json({ error: "Archived world not found." }, { status: 404 });
    const cleanup = await drainAssetCleanupJobs();
    return NextResponse.json({ success: true, deletedWorldId: deleted.id, deletedWorldTitle: deleted.title, assetCleanup: cleanup });
  } catch (error) {
    console.error("Failed to permanently delete archived world:", error);
    return NextResponse.json({ error: "Failed to permanently delete archived world." }, { status: 500 });
  }
});
