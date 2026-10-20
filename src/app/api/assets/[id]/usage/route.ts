import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { imageAssetId } from "@/lib/assets";

export interface AssetUsage {
  worldCover: boolean;
  worldBanner: boolean;
  worldBackground: boolean;
  articleCount: number;
  articles: { id: string; title: string; slug: string; categoryName: string | null }[];
}

/**
 * GET /api/assets/[id]/usage
 * Returns where an asset is referenced: world covers, banners, backgrounds, and article bodies.
 * Requires ownership of the world containing the asset.
 */
export const GET = withAuthor(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    
    if (!imageAssetId(id)) {
      return NextResponse.json({ error: "Invalid image ID" }, { status: 400 });
    }

    const asset = await prisma.imageAsset.findUnique({
      where: { id },
      select: { id: true, worldId: true, world: { select: { ownerId: true } } },
    });

    if (!asset) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const user = await import("@/lib/auth").then(m => m.sessionUser());
    if (user?.id !== asset.world.ownerId) {
      throw new AccessError("You do not have access to this image", 403);
    }

    const assetUrlPattern = `/api/assets/${id}/file`;

    // Check world-level references
    const world = await prisma.world.findUnique({
      where: { id: asset.worldId },
      select: {
        coverImage: true,
        bannerImage: true,
        appearance: true,
      },
    });

    const worldCover = world?.coverImage === assetUrlPattern;
    const worldBanner = world?.bannerImage === assetUrlPattern;
    
    let worldBackground = false;
    if (world?.appearance) {
      try {
        const appearance = JSON.parse(world.appearance);
        worldBackground = appearance.backgroundImage === assetUrlPattern;
      } catch {
        // Invalid appearance JSON, ignore
      }
    }

    // Check article bodies for image references
    const articlesWithAsset = await prisma.article.findMany({
      where: {
        worldId: asset.worldId,
        OR: [
          { contentHtml: { contains: assetUrlPattern } },
          { coverImage: assetUrlPattern },
        ],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        category: { select: { name: true } },
      },
      take: 50, // Limit results for performance
    });

    return NextResponse.json({
      worldCover,
      worldBanner,
      worldBackground,
      articleCount: articlesWithAsset.length,
      articles: articlesWithAsset.map(a => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        categoryName: a.category?.name ?? null,
      })),
    } satisfies AssetUsage);
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to check asset usage:", error);
    return NextResponse.json({ error: "Failed to check image usage" }, { status: 500 });
  }
});