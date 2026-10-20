import { withAuthor, sessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

    const revision = await prisma.articleRevision.findUnique({
      where: { id: revisionId },
      include: { article: true },
    });

    if (!revision || revision.articleId !== id) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }

    // Verify ownership: revision.article is already loaded via include
    const world = await prisma.world.findUnique({
      where: { id: revision.article.worldId },
      select: { ownerId: true },
    });
    
    if (!world || world.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // revision.article is already loaded via include, use it as the current state
    const currentArticle = revision.article;

    if (currentArticle) {
      await prisma.articleRevision.create({
        data: {
          articleId: id,
          userId: user.id,
          title: currentArticle.title,
          slug: currentArticle.slug,
          excerpt: currentArticle.excerpt,
          contentHtml: currentArticle.contentHtml,
          contentJson: currentArticle.contentJson,
          metadata: currentArticle.metadata,
          tags: currentArticle.tags,
          publicationStatus: currentArticle.publicationStatus,
          visibility: currentArticle.visibility,
          state: currentArticle.state,
          articleVersionAtSave: currentArticle.version,
        },
      });
    }

    // Now restore the revision
    const restored = await prisma.$transaction(async tx => {
      await tx.article.update({
        where: { id },
        data: {
          title: revision.title,
          slug: revision.slug,
          excerpt: revision.excerpt,
          contentHtml: revision.contentHtml,
          contentJson: revision.contentJson,
          metadata: revision.metadata,
          tags: revision.tags,
          publicationStatus: revision.publicationStatus,
          visibility: revision.visibility,
          state: revision.state,
          version: revision.articleVersionAtSave,
        },
      });
      
      return revision;
    });

    return NextResponse.json({ success: true, revision: restored });
  } catch (error: unknown) {
    console.error("Failed to restore revision:", error);
    return NextResponse.json({ error: "Unable to restore revision" }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
