import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { drainAssetCleanupJobs, purgeArchivedWorld } from "@/lib/world-management";

export const POST = withAuthor({ target: "world-param", archived: true }, async (_request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
  try {
    const { id } = await params;
    const deleted = await purgeArchivedWorld(id, user.id);
    if (!deleted) return NextResponse.json({ error: "Archived world not found." }, { status: 404 });
    const cleanup = await drainAssetCleanupJobs();
    return NextResponse.json({ success: true, purgedWorldId: deleted.id, purgedWorldTitle: deleted.title, assetCleanup: cleanup });
  } catch (error) {
    console.error("Failed to purge archived world:", error);
    return NextResponse.json({ error: "Failed to purge archived world." }, { status: 500 });
  }
});
