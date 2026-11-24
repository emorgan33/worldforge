import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveActor, readableWhere } from "@/lib/access";
import { SEARCH_PAGE_SIZE, parseCampaignSearchParams, presentSearchArticle, SearchInputError } from "@/lib/campaign-search";
import { rankedSearchPage } from "@/lib/campaign-search-db";

const noStore = { "Cache-Control": "private, no-store" };
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ worldSlug: string }> }) {
  try {
    const { worldSlug } = await params;
    const actor = await resolveActor();
    if (!actor.userId) return json({ error: "Sign in to search." }, 401);

    // Find world
    const world = await prisma.world.findFirst({
      where: { slug: worldSlug, deletedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!world) return json({ error: "World not found." }, 404);
    if (actor.kind === "PREVIEW" && actor.previewWorldId !== world.id) return json({ error: "Not found." }, 404);

    // Check if actor is the owner or an active member
    const isOwner = actor.userId === world.ownerId;
    if (!isOwner) {
      const member = await prisma.worldMember.findFirst({
        where: { worldId: world.id, userId: actor.userId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) return json({ error: "Not found." }, 404);
    }

    const filters = parseCampaignSearchParams(new URL(request.url).searchParams);

    // Keep search results aligned with index, sidebar, and direct-read rules.
    const { where } = await readableWhere(world.id, "articles", actor);

    const readableIds = where.id === "__NONE__"
      ? []
      : where.id && typeof where.id === "object" && "in" in where.id && Array.isArray(where.id.in)
        ? where.id.in as string[]
        : undefined;
    const [articles, categories] = await Promise.all([
      rankedSearchPage({ worldId: world.id, q: filters.q, cursor: filters.cursor, readableArticleIds: readableIds, searchBodies: false }),
      prisma.category.findMany({ where: { worldId: world.id }, select: { id: true, name: true, parentId: true, order: true } }),
    ]);
    const hasMore = articles.length > SEARCH_PAGE_SIZE;
    const page = articles.slice(0, SEARCH_PAGE_SIZE);
    return json({
      articles: page.map(article => presentSearchArticle(article, categories)),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  } catch (error: unknown) {
    if (error instanceof SearchInputError) return json({ error: error.message }, error.status);
    console.error("Player search failed:", error);
    return json({ error: "Unable to search." }, 500);
  }
}
