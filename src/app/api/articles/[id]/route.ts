import { isArticleVersion, type ArticleConflictResponse } from "@/lib/article-save";
import { publicationFields } from "@/lib/publication";
import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { syncArticleMentions } from "@/lib/article-mention-index";
import { assertDocumentImageReferences, assertImageReference, ImageReferenceError } from "@/lib/asset-validation";
import { validatePlacementAlt, normalizePlacementAlt } from "@/lib/image-placement";
import { prisma } from "@/lib/db";
import { validateCharacterRows } from "@/lib/character-sheet";
import { validateMetadataReferences } from "@/lib/metadata-references";

class ArticleConflict extends Error {}

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
  { params }: { params: Promise<{ id: string }> },
  { user }: { user: { id: string } },
) {
  try {
    const { id } = await params;
    
    const body = await req.json();

    if (body.expectedVersion !== undefined && !isArticleVersion(body.expectedVersion)) {
      return NextResponse.json({ error: "expectedVersion must be a positive safe integer." }, { status: 400 });
    }
    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) {
      const conflict: ArticleConflictResponse = { code: "ARTICLE_CONFLICT", error: "This article changed since you opened it. Your changes have not overwritten the saved article. Save a separate copy or reopen the article to reconcile them.", currentVersion: existing.version };
      return NextResponse.json(conflict, { status: 409 });
    }

    const {
      title,
      template,
      categoryId,
      excerpt,
      contentHtml,
      coverImage,
      coverImageAlt,
      portraitImage,
      portraitImageAlt,
      contentJson,
      metadata,
      tags,
      state, publicationStatus, visibility,
      isPinned,
      canonState,
    } = body;

    if (typeof contentJson === "string") return NextResponse.json({ error: "Article content must be a document object, not a serialized string." }, { status: 400 });
    const referenceError = metadata === undefined ? null : validateMetadataReferences(metadata);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });

    let previousMetadata: Record<string, unknown> = {};
    try { previousMetadata = JSON.parse(existing.metadata || "{}") || {}; } catch {}
    const sheetError = validateCharacterRows(metadata, previousMetadata);
    if (sheetError) return NextResponse.json({ error: sheetError }, { status: 400 });

    let publication;
    try { publication = publicationFields({ state, publicationStatus, visibility }, existing); } catch { return NextResponse.json({ error: "Invalid publication status or visibility" }, { status: 400 }); }
    const altError = validatePlacementAlt(coverImageAlt) || validatePlacementAlt(portraitImageAlt);
    if (altError) return NextResponse.json({ error: altError }, { status: 400 });
    if ((coverImage !== undefined && typeof coverImage !== "string") ||
      (portraitImage !== undefined && typeof portraitImage !== "string")) {
      return NextResponse.json({ error: "Cover and portrait images must be strings." }, { status: 400 });
    }
    if (categoryId && !await prisma.category.findFirst({ where: { id: categoryId, worldId: existing.worldId }, select: { id: true } })) {
      return NextResponse.json({ error: "Category not found in this world" }, { status: 400 });
    }
    const categoryChanged = categoryId !== undefined && categoryId !== existing.categoryId;
    const lastSibling = categoryChanged ? await prisma.article.findFirst({ where: { worldId: existing.worldId, categoryId }, orderBy: { order: "desc" }, select: { order: true } }) : null;
    
    // The version predicate also protects legacy callers against an overlapping write.
    const updated = await prisma.$transaction(async tx => {
      const write = await tx.article.updateMany({
        where: { id, version: existing.version },
        data: {
          ...(categoryChanged ? { order: (lastSibling?.order ?? -1) + 1 } : {}),
          title: title !== undefined ? title : existing.title,
          template: template !== undefined ? template : existing.template,
          categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
          excerpt: excerpt !== undefined ? excerpt : existing.excerpt,
          contentHtml: contentHtml !== undefined ? contentHtml : existing.contentHtml,
          ...(coverImage !== undefined ? { coverImage: coverImage.trim() || null } : {}),
          ...(coverImageAlt !== undefined ? { coverImageAlt: normalizePlacementAlt(coverImageAlt) } : {}),
          ...(portraitImage !== undefined ? { portraitImage: portraitImage.trim() || null } : {}),
          ...(portraitImageAlt !== undefined ? { portraitImageAlt: normalizePlacementAlt(portraitImageAlt) } : {}),
          contentJson: contentJson !== undefined ? (contentJson ? JSON.stringify(contentJson) : null) : contentHtml !== undefined ? null : existing.contentJson,
          metadata: metadata !== undefined ? JSON.stringify(metadata) : existing.metadata,
          tags: tags !== undefined ? tags : existing.tags,
          ...publication,
          isPinned: isPinned !== undefined ? isPinned : existing.isPinned,
          version: { increment: 1 },
          canonState: canonState !== undefined ? canonState : existing.canonState,
          wordCount:
            contentHtml !== undefined
              ? contentHtml.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length
              : existing.wordCount,
        },
      });

      if (write.count !== 1) throw new ArticleConflict();
      if (coverImage !== undefined) await assertImageReference(coverImage, existing.worldId, tx);
      if (portraitImage !== undefined) await assertImageReference(portraitImage, existing.worldId, tx);
      if (contentHtml !== undefined || contentJson !== undefined) {
        const nextContentJson = contentJson !== undefined ? contentJson : contentHtml !== undefined ? null : existing.contentJson;
        const nextContentHtml = contentHtml !== undefined ? contentHtml : existing.contentHtml;
        await assertDocumentImageReferences(nextContentJson, nextContentHtml, existing.worldId, tx);
      }

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
          coverImage: existing.coverImage,
          coverImageAlt: existing.coverImageAlt,
          portraitImage: existing.portraitImage,
          portraitImageAlt: existing.portraitImageAlt,
          publicationStatus: existing.publicationStatus,
          visibility: existing.visibility,
          state: existing.state,
          articleVersionAtSave: existing.version,
        },
      });

      if (contentHtml !== undefined || contentJson !== undefined) {
        await syncArticleMentions(tx, existing.worldId, id, contentJson, contentHtml ?? existing.contentHtml ?? "");
      }
      // Read within this transaction so the response carries this write's version.
      return tx.article.findUniqueOrThrow({
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

    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof ArticleConflict) {
      const { id } = await params;
      const current = await prisma.article.findUnique({ where: { id }, select: { version: true } });
      const conflict: ArticleConflictResponse = { code: "ARTICLE_CONFLICT", error: "This article changed while saving. Your changes have not overwritten the saved article. Save a separate copy or reopen the article to reconcile them.", currentVersion: current?.version ?? null };
      return NextResponse.json(conflict, { status: 409 });
    }
    if (error instanceof ImageReferenceError) return NextResponse.json({ error: error.message }, { status: 400 });
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

export const GET = withAuthor({ target: "resource-param", kind: "articles" }, getHandler);
export const PATCH = withAuthor({ target: "resource-param", kind: "articles" }, patchHandler);
export const DELETE = withAuthor({ target: "resource-param", kind: "articles" }, deleteHandler);
