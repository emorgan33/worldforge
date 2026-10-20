import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveActor, readableWhere } from "@/lib/access";
import { searchTerms, paginateSearch, rankSearchArticles, presentSearchArticle, SearchInputError } from "@/lib/campaign-search";

export async function GET(request: NextRequest, { params }: { params: Promise<{ worldSlug: string }> }) {
  try {
    const { worldSlug } = await params;
    const actor = await resolveActor();
    if (!actor.userId) {
      return NextResponse.json({ error: "Sign in to search." }, { status: 401 });
    }

    // Find world
    const world = await prisma.world.findFirst({
      where: { slug: worldSlug },
      select: { id: true, ownerId: true },
    });
    if (!world) {
      return NextResponse.json({ error: "World not found." }, { status: 404 });
    }
    if (actor.kind === "PREVIEW" && actor.previewWorldId !== world.id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    // Check if actor is the owner or an active member
    const isOwner = actor.userId === world.ownerId;
    if (!isOwner) {
      const member = await prisma.worldMember.findFirst({
        where: { worldId: world.id, userId: actor.userId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").slice(0, 200);
    const cursor = url.searchParams.get("cursor") || "";
    const terms = searchTerms(q);

    // Keep search results aligned with index, sidebar, and direct-read rules.
    const { where } = await readableWhere(world.id, "articles", actor);

    if (terms.length) {
      where.AND = terms.map(term => ({
        OR: [
          { title: { contains: term } },
          { excerpt: { contains: term } },
          { tags: { contains: term } },
        ],
      }));
    }

    const articles = await prisma.article.findMany({
      where,
      select: { id: true, title: true, excerpt: true, tags: true, template: true, publicationStatus: true, categoryId: true },
    });

    const categories = await prisma.category.findMany({
      where: { worldId: world.id },
      select: { id: true, name: true, parentId: true, order: true },
    });

    const page = paginateSearch(rankSearchArticles(articles, q), cursor || undefined);
    return NextResponse.json({
      articles: page.items.map(article => presentSearchArticle(article, categories)),
      nextCursor: page.nextCursor,
    });
  } catch (error: unknown) {
    if (error instanceof SearchInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Player search failed:", error);
    return NextResponse.json({ error: "Unable to search." }, { status: 500 });
  }
}