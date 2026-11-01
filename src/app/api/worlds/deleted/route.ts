import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { drainAssetCleanupJobs } from "@/lib/world-management";

// GET /api/worlds/deleted - List soft-deleted worlds for current user
export const GET = withAuthor({ target: "account" }, async (_request, _context, { user }) => {
  if (!user) return NextResponse.json({ error: "Sign in to view deleted worlds." }, { status: 401 });

  try {
    const assetCleanup = await drainAssetCleanupJobs();
    const deletedWorlds = await prisma.world.findMany({
      where: {
        ownerId: user.id,
        deletedAt: { not: null },
      },
      orderBy: [{ deletedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        genre: true,
        system: true,
        deletedAt: true,
        createdAt: true,
        _count: {
          select: {
            articles: true,
            maps: true,
            timelines: true,
            secrets: true,
            variableCollections: true,
          },
        },
      },
    });

    return NextResponse.json({ worlds: deletedWorlds, assetCleanup });
  } catch (error) {
    console.error("Failed to fetch deleted worlds:", error);
    return NextResponse.json({ error: "Failed to fetch deleted worlds" }, { status: 500 });
  }
});

