import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { assertDocumentImageReferences, assertImageReference, ImageReferenceError } from "@/lib/asset-validation";
import { syncArticleAssetReferences, syncArticleMentions } from "@/lib/article-mention-index";
import { clonedArticleSlug } from "@/lib/world-transfer-adapters";

export const POST = withAuthor({ target: "resource-param", kind: "articles" }, async (request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
  try {
    const { id } = await params;

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
    let newSlug = clonedArticleSlug(source.slug, slugSuffix);
    while (await prisma.article.findFirst({ where: { slug: newSlug }, select: { id: true } })) {
      slugSuffix++;
      newSlug = clonedArticleSlug(source.slug, slugSuffix);
    }

    const newArticle = await prisma.$transaction(async tx => {
      if (source.coverImage) await assertImageReference(source.coverImage, source.worldId, tx);
      if (source.portraitImage) await assertImageReference(source.portraitImage, source.worldId, tx);
      await assertDocumentImageReferences(source.contentJson, source.contentHtml, source.worldId, tx);
      const created = await tx.article.create({
      data: {
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

      // A clone is a new private article lifecycle: never copy the source's
      // audience grants, revision history, publication state, or provenance.
      await tx.audiencePolicy.create({
        data: {
          id: randomUUID(),
          worldId: source.worldId,
          resourceKind: "articles",
          resourceId: created.id,
          mode: "GM_ONLY",
          createdById: user.id,
        },
      });
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
          coverImage: created.coverImage,
          coverImageAlt: created.coverImageAlt,
          portraitImage: created.portraitImage,
          portraitImageAlt: created.portraitImageAlt,
          publicationStatus: created.publicationStatus,
          visibility: created.visibility,
          state: created.state,
          articleVersionAtSave: created.version,
        },
      });
      let contentDocument: unknown = null;
      try { contentDocument = created.contentJson ? JSON.parse(created.contentJson) : null; } catch { /* Keep legacy HTML references available. */ }
      await syncArticleMentions(tx, source.worldId, created.id, contentDocument, created.contentHtml ?? "");
      await syncArticleAssetReferences(tx, created.id, contentDocument, created.contentHtml ?? "", created.coverImage, created.portraitImage);
      return created;
    });

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
      state: newArticle.state,
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
    if (error instanceof ImageReferenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to clone article:", error);
    return NextResponse.json({ error: "Failed to clone article" }, { status: 500 });
  }
});
