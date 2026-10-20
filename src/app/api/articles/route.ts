import { publicationFields } from "@/lib/publication";
import { withAuthor, sessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { syncArticleMentions } from "@/lib/article-mention-index";
import { validateImageReference } from "@/lib/asset-validation";
import { prisma } from "@/lib/db";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");
    const categoryId = searchParams.get("categoryId");
    const template = searchParams.get("template");
    const query = searchParams.get("q");

    const where: Prisma.ArticleWhereInput = {};
    if (worldId) where.worldId = worldId;
    if (categoryId) where.categoryId = categoryId;
    if (template) where.template = template;
    if (query) {
      where.OR = [
        { title: { contains: query } },
        { excerpt: { contains: query } },
        { tags: { contains: query } },
      ];
    }

    // Capped at 2000 articles for safety — frontend uses client-side tree filtering
    const MAX_ARTICLES = 2000;
    const articles = await prisma.article.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true, icon: true },
        },
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      take: MAX_ARTICLES,
    });

    return NextResponse.json(articles);
  } catch (error: unknown) {
    console.error("Failed to list articles:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const body = await req.json();
    const {
      worldId,
      categoryId,
      template,
      title,
      slug,
      excerpt,
      contentHtml,
      coverImage,
      contentJson,
      metadata,
      tags,
      state,
      publicationStatus, visibility,
      canonState,
    } = body;

    if (!worldId || !title) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let publication;
    try { publication = publicationFields({ state, publicationStatus, visibility }); } catch { return NextResponse.json({ error: "Invalid publication status or visibility" }, { status: 400 }); }
    if (coverImage !== undefined) {
      const error = await validateImageReference(coverImage, worldId);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    if (categoryId && !await prisma.category.findFirst({ where: { id: categoryId, worldId }, select: { id: true } })) {
      return NextResponse.json({ error: "Category not found in this world" }, { status: 400 });
    }
    const lastSibling = await prisma.article.findFirst({ where: { worldId, categoryId: categoryId || null }, orderBy: { order: "desc" }, select: { order: true } });

    const generatedSlug =
      slug ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const article = await prisma.$transaction(async tx => {
      const created = await tx.article.create({
        data: {
          worldId,
          categoryId: categoryId || null,
          order: (lastSibling?.order ?? -1) + 1,
          template: template || "GENERIC",
          title,
          slug: `${generatedSlug}-${Date.now().toString(36)}`,
          excerpt: excerpt || null,
          contentHtml: contentHtml || "",
          coverImage: coverImage?.trim() || null,
          contentJson: contentJson ? JSON.stringify(contentJson) : null,
          metadata: metadata ? JSON.stringify(metadata) : null,
          tags: tags || null,
          ...publication,
          canonState: canonState || "GM_DRAFT",
          wordCount: contentHtml ? contentHtml.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length : 0,
          version: 1,
        },
      });

      // Create initial revision
      await tx.articleRevision.create({
        data: {
          articleId: created.id,
          userId: user.id,
          title: created.title,
          slug: created.slug,
          excerpt: created.excerpt,
          contentHtml: created.contentHtml,
          contentJson: created.contentJson,
          metadata: created.metadata,
          tags: created.tags,
          publicationStatus: created.publicationStatus,
          visibility: created.visibility,
          state: created.state,
          articleVersionAtSave: 1,
        },
      });

      await syncArticleMentions(tx, worldId, created.id, contentJson, contentHtml || "");
      return created;
    });

    return NextResponse.json(article, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to create article:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
