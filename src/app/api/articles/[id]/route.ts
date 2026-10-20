import { publicationFields } from "@/lib/publication";
import { withAuthor, sessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { syncArticleMentions } from "@/lib/article-mention-index";
import { validateImageReference } from "@/lib/asset-validation";
import { prisma } from "@/lib/db";

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        category: true,
        parent: {
          select: { id: true, title: true, template: true },
        },
        children: {
          select: { id: true, title: true, template: true },
        },
        outboundMentions: {
          include: {
            targetArticle: {
              select: { id: true, title: true, template: true, excerpt: true },
            },
          },
        },
        inboundMentions: {
          include: {
            sourceArticle: {
              select: { id: true, title: true, template: true, excerpt: true },
            },
          },
        },
        secrets: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 400 });
    }

    return NextResponse.json(article);
  } catch (error: unknown) {
    console.error("Failed to get article:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const body = await req.json();

    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const {
      title,
      template,
      categoryId,
      excerpt,
      contentHtml,
      coverImage,
      contentJson,
      metadata,
      tags,
      state, publicationStatus, visibility,
      isPinned,
      canonState,
    } = body;

    let publication;
    try { publication = publicationFields({ state, publicationStatus, visibility }, existing); } catch { return NextResponse.json({ error: "Invalid publication status or visibility" }, { status: 400 }); }
    if (coverImage !== undefined) {
      const error = await validateImageReference(coverImage, existing.worldId);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    if (categoryId && !await prisma.category.findFirst({ where: { id: categoryId, worldId: existing.worldId }, select: { id: true } })) {
      return NextResponse.json({ error: "Category not found in this world" }, { status: 400 });
    }
    const categoryChanged = categoryId !== undefined && categoryId !== existing.categoryId;
    const lastSibling = categoryChanged ? await prisma.article.findFirst({ where: { worldId: existing.worldId, categoryId }, orderBy: { order: "desc" }, select: { order: true } }) : null;
    
    // Create a revision before updating (for history)
    await prisma.$transaction(async tx => {
      const saved = await tx.article.update({
        where: { id },
        data: {
          ...(categoryChanged ? { order: (lastSibling?.order ?? -1) + 1 } : {}),
          title: title !== undefined ? title : existing.title,
          template: template !== undefined ? template : existing.template,
          categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
          excerpt: excerpt !== undefined ? excerpt : existing.excerpt,
          contentHtml: contentHtml !== undefined ? contentHtml : existing.contentHtml,
          ...(coverImage !== undefined ? { coverImage: coverImage.trim() || null } : {}),
          contentJson: contentJson !== undefined ? (contentJson ? JSON.stringify(contentJson) : null) : contentHtml !== undefined ? null : existing.contentJson,
          metadata: metadata !== undefined ? JSON.stringify(metadata) : existing.metadata,
          tags: tags !== undefined ? tags : existing.tags,
          ...publication,
          isPinned: isPinned !== undefined ? isPinned : existing.isPinned,
          version: existing.version + 1,
          canonState: canonState !== undefined ? canonState : existing.canonState,
          wordCount:
            contentHtml !== undefined
              ? contentHtml.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length
              : existing.wordCount,
        },
      });

      // Create revision with snapshot of previous state
      await tx.articleRevision.create({
        data: {
          articleId: id,
          userId: user.id,
          title: existing.title,
          slug: existing.slug,
          excerpt: existing.excerpt,
          contentHtml: existing.contentHtml,
          contentJson: existing.contentJson,
          metadata: existing.metadata,
          tags: existing.tags,
          publicationStatus: existing.publicationStatus,
          visibility: existing.visibility,
          state: existing.state,
          articleVersionAtSave: existing.version,
        },
      });

      if (contentHtml !== undefined || contentJson !== undefined) {
        await syncArticleMentions(tx, existing.worldId, id, contentJson, contentHtml ?? existing.contentHtml ?? "");
      }
    });

    // Return updated article
    const updated = await prisma.article.findUnique({
      where: { id },
      include: {
        category: true,
        parent: {
          select: { id: true, title: true, template: true },
        },
        children: {
          select: { id: true, title: true, template: true },
        },
        outboundMentions: {
          include: {
            targetArticle: {
              select: { id: true, title: true, template: true, excerpt: true },
            },
          },
        },
        inboundMentions: {
          include: {
            sourceArticle: {
              select: { id: true, title: true, template: true, excerpt: true },
            },
          },
        },
        secrets: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Failed to update article:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.article.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Failed to delete article:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const PATCH = withAuthor(patchHandler);
export const DELETE = withAuthor(deleteHandler);
