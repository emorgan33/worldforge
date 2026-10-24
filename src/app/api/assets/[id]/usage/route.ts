import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAssetId } from "@/lib/assets";
import { scanAssetReferences } from "@/lib/asset-references";

export interface AssetUsage {
  worldCover: boolean;
  worldBanner: boolean;
  worldBackground: boolean;
  categoryCount: number;
  categories: { id: string; name: string }[];
  articleCount: number;
  articles: { id: string; title: string; slug: string; categoryName: string | null }[];
}

/**
 * GET /api/assets/[id]/usage
 * Returns every persistent reference to an asset: world covers, banners,
 * backgrounds, category illustrations, and article covers/portraits/bodies.
 * Requires ownership of the world containing the asset.
 */
export const GET = withAuthor(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!isAssetId(id)) {
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

    const references = await scanAssetReferences(asset.worldId, id);

    return NextResponse.json({
      worldCover: references.worldCover,
      worldBanner: references.worldBanner,
      worldBackground: references.worldBackground,
      categoryCount: references.categories.length,
      categories: references.categories,
      articleCount: references.articles.length,
      articles: references.articles,
    } satisfies AssetUsage);
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to check asset usage:", error);
    return NextResponse.json({ error: "Failed to check image usage" }, { status: 500 });
  }
});
