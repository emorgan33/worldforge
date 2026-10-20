import { withAuthor } from "@/lib/auth";
import { articleSearchWhere, paginateSearch, parseCampaignSearchParams, presentSearchArticle, rankSearchArticles, SearchInputError } from "@/lib/campaign-search";
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
    const articles = await prisma.article.findMany({
      where: articleSearchWhere(worldId, filters),
      select: { id: true, title: true, excerpt: true, tags: true, template: true, publicationStatus: true, categoryId: true },
    });
    const page = paginateSearch(rankSearchArticles(articles, filters.q), filters.cursor);
    return NextResponse.json({ articles: page.items.map(article => presentSearchArticle(article, categories)), nextCursor: page.nextCursor });
  } catch (error: unknown) {
    if (error instanceof SearchInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Campaign search failed:", error);
    return NextResponse.json({ error: "Unable to search this campaign." }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
