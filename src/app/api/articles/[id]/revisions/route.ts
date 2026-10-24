import { withAuthor, sessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncArticleMentions } from "@/lib/article-mention-index";
import { assertDocumentImageReferences, assertImageReference, ImageReferenceError } from "@/lib/asset-validation";

class ArticleRestoreConflict extends Error {}

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Verify user owns this article
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const article = await prisma.article.findUnique({
      where: { id },
      select: { worldId: true },
    });
    
    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Check user has access to this world
    const world = await prisma.world.findUnique({
      where: { id: article.worldId },
      select: { ownerId: true },
    });
    
    if (!world || world.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const revisions = await prisma.articleRevision.findMany({
      where: { articleId: id },
      orderBy: { savedAt: "desc" },
      select: {
        id: true,
        savedAt: true,
        title: true,
        slug: true,
        excerpt: true,
        publicationStatus: true,
        visibility: true,
        state: true,
        coverImage: true,
        coverImageAlt: true,
        portraitImage: true,
        portraitImageAlt: true,
        articleVersionAtSave: true,
        user: {
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json({ revisions });
  } catch (error: unknown) {
    console.error("Failed to list revisions:", error);
    return NextResponse.json({ error: "Unable to load revisions" }, { status: 500 });
  }
}

async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const body = await req.json();
    const { revisionId } = body;

    if (!revisionId) {
      return NextResponse.json({ error: "Revision ID is required" }, { status: 400 });
    }

    const article = await prisma.article.findUnique({ where: { id }, select: { id: true, worldId: true } });
    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }
    const revision = await prisma.articleRevision.findFirst({ where: { id: revisionId, articleId: id }, select: { id: true } });
    if (!revision) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }

    const world = await prisma.world.findUnique({
      where: { id: article.worldId },
      select: { ownerId: true },
    });
    
    if (!world || world.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const restored = await prisma.$transaction(async tx => {
      const currentArticle = await tx.article.findUnique({ where: { id } });
      const targetRevision = await tx.articleRevision.findFirst({ where: { id: revisionId, articleId: id } });
      if (!currentArticle || !targetRevision) throw new Error("Article or revision no longer exists.");

      // Keep the rollback point in the same transaction as the restore.
      await tx.articleRevision.create({
        data: {
          articleId: id, userId: user.id, title: currentArticle.title, slug: currentArticle.slug,
          excerpt: currentArticle.excerpt, contentHtml: currentArticle.contentHtml,
          contentJson: currentArticle.contentJson, metadata: currentArticle.metadata, tags: currentArticle.tags,
          coverImage: currentArticle.coverImage, coverImageAlt: currentArticle.coverImageAlt,
          portraitImage: currentArticle.portraitImage, portraitImageAlt: currentArticle.portraitImageAlt,
          publicationStatus: currentArticle.publicationStatus, visibility: currentArticle.visibility,
          state: currentArticle.state, articleVersionAtSave: currentArticle.version,
        },
      });

      if (targetRevision.coverImage) await assertImageReference(targetRevision.coverImage, currentArticle.worldId, tx);
      if (targetRevision.portraitImage) await assertImageReference(targetRevision.portraitImage, currentArticle.worldId, tx);
      await assertDocumentImageReferences(targetRevision.contentJson, targetRevision.contentHtml, currentArticle.worldId, tx);

      const wordText = (targetRevision.contentHtml || "").replace(/<[^>]*>/g, " ").trim();
      const write = await tx.article.updateMany({
        where: { id, version: currentArticle.version },
        data: {
          title: targetRevision.title,
          slug: targetRevision.slug,
          excerpt: targetRevision.excerpt,
          contentHtml: targetRevision.contentHtml,
          contentJson: targetRevision.contentJson,
          metadata: targetRevision.metadata,
          tags: targetRevision.tags,
          coverImage: targetRevision.coverImage,
          coverImageAlt: targetRevision.coverImageAlt,
          portraitImage: targetRevision.portraitImage,
          portraitImageAlt: targetRevision.portraitImageAlt,
          publicationStatus: targetRevision.publicationStatus,
          visibility: targetRevision.visibility,
          state: targetRevision.state,
          wordCount: wordText ? wordText.split(/\s+/).length : 0,
          version: { increment: 1 },
        },
      });
      if (write.count !== 1) throw new ArticleRestoreConflict();

      let restoredContentJson: unknown = null;
      try { restoredContentJson = targetRevision.contentJson ? JSON.parse(targetRevision.contentJson) : null; } catch { /* use the historical HTML representation */ }
      await syncArticleMentions(tx, currentArticle.worldId, id, restoredContentJson, targetRevision.contentHtml || "");
      const updatedArticle = await tx.article.findUniqueOrThrow({ where: { id } });
      return { revision: targetRevision, article: updatedArticle };
    });

    return NextResponse.json({ success: true, ...restored });
  } catch (error: unknown) {
    if (error instanceof ArticleRestoreConflict) return NextResponse.json({ error: "Article changed during restore. Retry from the latest state." }, { status: 409 });
    if (error instanceof ImageReferenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Failed to restore revision:", error);
    return NextResponse.json({ error: "Unable to restore revision" }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
