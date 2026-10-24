import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { findStockArtEntry, loadStockArtCatalog, StockArtError } from "@/lib/stock-art";
import { hasApprovedStockReview } from "@/lib/stock-provenance";

function failure(error: unknown) {
  if (error instanceof StockArtError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Stock-art details request failed", error);
  return NextResponse.json({ error: "Unable to load this artwork's details." }, { status: 500 });
}

async function getHandler(_request: Request, context: { params: Promise<{ id: string; entryId: string; version: string }> }) {
  try {
    const { id: worldId, entryId, version: rawVersion } = await context.params;
    const version = Number(rawVersion);
    if (!Number.isSafeInteger(version) || version < 1) throw new StockArtError("Choose a valid artwork version.");
    const { catalog, manifestDigest } = await loadStockArtCatalog();
    const entry = findStockArtEntry(catalog, entryId, version);
    if (!entry) throw new StockArtError("This artwork is not in the installed catalog.", 404);
    return NextResponse.json({
      catalogRevision: catalog.catalogRevision,
      manifestDigest,
      entry: {
        id: entry.id,
        version: entry.version,
        collection: entry.collection,
        collectionTitle: catalog.collections.find(item => item.id === entry.collection)?.title || entry.collection,
        title: entry.title,
        reviewStatus: hasApprovedStockReview(entry) ? "approved" : "pending",
        subjectTypes: entry.subjectTypes,
        styleTags: entry.styleTags,
        searchTerms: entry.searchTerms,
        defaultAlt: entry.defaultAlt,
        visual: entry.visual,
        creator: entry.creator,
        source: entry.source,
        rights: {
          licenseId: entry.rights.licenseId,
          licenseUrl: entry.rights.licenseUrl,
          publicDomainBasis: entry.rights.publicDomainBasis,
          evidence: {
            id: entry.rights.evidence.id,
            sha256: entry.rights.evidence.sha256,
            reviewer: entry.rights.evidence.reviewer,
            reviewedAt: entry.rights.evidence.reviewedAt,
          },
        },
        allowedUses: entry.allowedUses,
        attribution: entry.attribution,
        derivatives: {
          originalSha256: entry.derivatives.originalSha256,
          imageSha256: entry.derivatives.imageSha256,
          thumbnailSha256: entry.derivatives.thumbnailSha256,
          width: entry.derivatives.width,
          height: entry.derivatives.height,
          byteSize: entry.derivatives.byteSize,
          thumbnail: entry.derivatives.thumbnail,
          normalizationRecipe: entry.derivatives.normalizationRecipe,
          modifications: entry.derivatives.modifications,
        },
        lifecycle: entry.lifecycle,
        thumbnailUrl: `/api/worlds/${worldId}/stock-art/${entry.id}/${entry.version}/preview?size=thumb`,
        previewUrl: `/api/worlds/${worldId}/stock-art/${entry.id}/${entry.version}/preview?size=full`,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export const GET = withAuthor(getHandler);
