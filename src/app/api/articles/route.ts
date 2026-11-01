import { publicationFields } from "@/lib/publication";
import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { syncArticleAssetReferences, syncArticleMentions } from "@/lib/article-mention-index";
import { assertDocumentImageReferences, assertImageReference, ImageReferenceError } from "@/lib/asset-validation";
import { validatePlacementAlt, normalizePlacementAlt } from "@/lib/image-placement";
import { prisma } from "@/lib/db";
import { validateCharacterRows } from "@/lib/character-sheet";
import { validateMetadataReferences } from "@/lib/metadata-references";
import { validTransferSlug } from "@/lib/world-transfer-adapters";

const ARTICLE_LIST_PAGE_SIZE = 200;

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");
    const categoryId = searchParams.get("categoryId");
    const template = searchParams.get("template");
    const query = searchParams.get("q");
    const cursor = searchParams.get("cursor");

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
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) {
      return NextResponse.json({ error: "Invalid article-list cursor." }, { status: 400 });
    }

    // Resolve the cursor inside the filtered result set before using it. This
    // keeps a foreign or stale cursor from shifting the requested list page.
    if (cursor && !await prisma.article.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) {
      return NextResponse.json({ error: "Invalid article-list cursor." }, { status: 400 });
    }

    const articles = await prisma.article.findMany({
      where,
      // The workspace list needs summaries only. Keep article bodies, metadata,
      // tags, versioning and relation collections on the selected detail route.
      select: {
        id: true,
        worldId: true,
        categoryId: true,
        template: true,
        title: true,
        slug: true,
        excerpt: true,
        publicationStatus: true,
        visibility: true,
        state: true,
        isPinned: true,
        order: true,
        wordCount: true,
        coverImage: true,
        coverImageAlt: true,
        portraitImage: true,
        portraitImageAlt: true,
        createdAt: true,
        updatedAt: true,
        category: {
          select: { id: true, name: true, icon: true },
        },
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: ARTICLE_LIST_PAGE_SIZE + 1,
    });

    const hasMore = articles.length > ARTICLE_LIST_PAGE_SIZE;
    return NextResponse.json(hasMore ? articles.slice(0, ARTICLE_LIST_PAGE_SIZE) : articles);
  } catch (error: unknown) {
    console.error("Failed to list articles:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

async function postHandler(req: NextRequest, _context: unknown, { user }: { user: { id: string } }) {
  try {
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
      coverImageAlt,
      portraitImage,
      portraitImageAlt,
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
    if (typeof contentJson === "string") return NextResponse.json({ error: "Article content must be a document object, not a serialized string." }, { status: 400 });
    const referenceError = validateMetadataReferences(metadata);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
    const sheetError = validateCharacterRows(metadata);
    if (sheetError) return NextResponse.json({ error: sheetError }, { status: 400 });

    let publication;
    try { publication = publicationFields({ state, publicationStatus, visibility }); } catch { return NextResponse.json({ error: "Invalid publication status or visibility" }, { status: 400 }); }
    const altError = validatePlacementAlt(coverImageAlt) || validatePlacementAlt(portraitImageAlt);
    if (altError) return NextResponse.json({ error: altError }, { status: 400 });
    if (categoryId && !await prisma.category.findFirst({ where: { id: categoryId, worldId }, select: { id: true } })) {
      return NextResponse.json({ error: "Category not found in this world" }, { status: 400 });
    }
    const lastSibling = await prisma.article.findFirst({ where: { worldId, categoryId: categoryId || null }, orderBy: { order: "desc" }, select: { order: true } });

    const generatedSlug =
      slug ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 100) || "article";
    if (!validTransferSlug(generatedSlug) || generatedSlug.length > 100) return NextResponse.json({ error: "Article slug must contain only letters, numbers, underscores or hyphens." }, { status: 400 });

    const article = await prisma.$transaction(async tx => {
      if (coverImage !== undefined) await assertImageReference(coverImage, worldId, tx);
      if (portraitImage !== undefined) await assertImageReference(portraitImage, worldId, tx);
      await assertDocumentImageReferences(contentJson, contentHtml, worldId, tx);
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
          coverImageAlt: normalizePlacementAlt(coverImageAlt) ?? null,
          portraitImage: portraitImage?.trim() || null,
          portraitImageAlt: normalizePlacementAlt(portraitImageAlt) ?? null,
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
          coverImage: created.coverImage,
          coverImageAlt: created.coverImageAlt,
          portraitImage: created.portraitImage,
          portraitImageAlt: created.portraitImageAlt,
          publicationStatus: created.publicationStatus,
          visibility: created.visibility,
          state: created.state,
          articleVersionAtSave: 1,
        },
      });

      await syncArticleMentions(tx, worldId, created.id, contentJson, contentHtml || "");
      await syncArticleAssetReferences(tx, created.id, contentJson, contentHtml || "", created.coverImage, created.portraitImage);
      return created;
    });

    return NextResponse.json(article, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ImageReferenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Failed to create article:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process article." }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
export const POST = withAuthor({ target: "world-body", field: "worldId" }, postHandler);
