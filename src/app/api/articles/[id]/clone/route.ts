import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";

export const POST = withAuthor(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const user = await import("@/lib/auth").then(m => m.sessionUser());
    if (!user) throw new AccessError("Sign in first", 401);

    const source = await prisma.article.findUnique({
      where: { id },
      include: {
        world: { select: { id: true, ownerId: true, slug: true } },
      },
    });

    if (!source) return NextResponse.json({ error: "Article not found" }, { status: 404 });
    if (source.world.ownerId !== user.id) throw new AccessError("You do not have access to this article", 403);

    // Generate unique slug
    let slugSuffix = 0;
    let newSlug = `${source.slug}-copy`;
    while (await prisma.article.findFirst({ where: { slug: newSlug }, select: { id: true } })) {
      slugSuffix++;
      newSlug = `${source.slug}-copy-${slugSuffix}`;
    }

    const newArticleId = randomUUID();
    const newArticle = await prisma.article.create({
      data: {
        id: newArticleId,
        worldId: source.worldId,
        categoryId: source.categoryId,
        template: source.template,
        title: `${source.title} (copy)`,
        slug: newSlug,
        excerpt: source.excerpt,
        contentHtml: source.contentHtml,
        contentJson: source.contentJson,
        metadata: source.metadata,
        tags: source.tags,
        publicationStatus: "DRAFT",
        visibility: "PRIVATE",
        state: "DRAFT",
        coverImage: source.coverImage,
        coverImageAlt: source.coverImageAlt,
        portraitImage: source.portraitImage,
        portraitImageAlt: source.portraitImageAlt,
        parentId: source.parentId,
        order: source.order,
        isPinned: source.isPinned,
        wordCount: source.wordCount,
        canonState: "GM_DRAFT",
        // Do NOT copy revealedInSessionId or supersededById
        revealedInSessionId: null,
        supersededById: null,
      },
    });

    // Create a fresh GM_ONLY audience policy for the clone (does NOT copy source grants)
    await prisma.audiencePolicy.create({
      data: {
        id: randomUUID(),
        worldId: source.worldId,
        resourceKind: "articles",
        resourceId: newArticleId,
        mode: "GM_ONLY",
        createdById: user.id,
      },
    });

    // Clone outbound mentions
    const mentions = await prisma.articleMention.findMany({
      where: { sourceArticleId: id },
    });
    for (const mention of mentions) {
      await prisma.articleMention.create({
        data: {
          sourceArticleId: newArticleId,
          targetArticleId: mention.targetArticleId,
          mentionText: mention.mentionText,
        },
      });
    }

    // Return serialized article
    const serialized = {
      id: newArticle.id,
      worldId: newArticle.worldId,
      categoryId: newArticle.categoryId,
      template: newArticle.template,
      title: newArticle.title,
      slug: newArticle.slug,
      excerpt: newArticle.excerpt,
      contentHtml: newArticle.contentHtml,
      contentJson: newArticle.contentJson,
      metadata: newArticle.metadata,
      tags: newArticle.tags,
      publicationStatus: newArticle.publicationStatus,
      visibility: newArticle.visibility,
      coverImage: newArticle.coverImage,
      coverImageAlt: newArticle.coverImageAlt,
      portraitImage: newArticle.portraitImage,
      portraitImageAlt: newArticle.portraitImageAlt,
      parentId: newArticle.parentId,
      order: newArticle.order,
      isPinned: newArticle.isPinned,
      wordCount: newArticle.wordCount,
      version: newArticle.version,
      canonState: newArticle.canonState,
      createdAt: newArticle.createdAt,
      updatedAt: newArticle.updatedAt,
    };

    return NextResponse.json(serialized, { status: 201 });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to clone article:", error);
    return NextResponse.json({ error: "Failed to clone article" }, { status: 500 });
  }
});