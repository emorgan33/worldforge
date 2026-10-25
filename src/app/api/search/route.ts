import { withAuthor } from "@/lib/auth";
import { SEARCH_PAGE_SIZE, parseCampaignSearchParams, presentSearchArticle, SearchInputError } from "@/lib/campaign-search";
import { rankedSearchPage } from "@/lib/campaign-search-db";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

async function getHandler(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const worldId = params.get("worldId");
    if (!worldId) throw new SearchInputError("A world is required.");
    const filters = parseCampaignSearchParams(params);
    const categories = await prisma.category.findMany({ where: { worldId }, select: { id: true, name: true, parentId: true, order: true } });
    if (filters.categoryId && !categories.some(category => category.id === filters.categoryId)) throw new SearchInputError("Category not found in this world.", 404);
    const articles = await rankedSearchPage({ ...filters, worldId });
    const hasMore = articles.length > SEARCH_PAGE_SIZE;
    const page = articles.slice(0, SEARCH_PAGE_SIZE);
    return NextResponse.json({
      articles: page.map(article => presentSearchArticle(article, categories)),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  } catch (error: unknown) {
    if (error instanceof SearchInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Campaign search failed:", error);
    return NextResponse.json({ error: "Unable to search this campaign." }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
