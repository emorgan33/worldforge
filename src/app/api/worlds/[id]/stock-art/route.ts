import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { materializeStockArt } from "@/lib/stock-art-storage";
import { hasApprovedStockReview } from "@/lib/stock-provenance";
import {
  isStockArtSelectable,
  loadStockArtCatalog,
  STOCK_ART_PURPOSES,
  STOCK_ART_SUBJECTS,
  StockArtError,
  type StockArtManifestEntry,
  type StockArtPurpose,
  type StockArtSubject,
} from "@/lib/stock-art";

const PAGE_SIZE = 24;

function failure(error: unknown) {
  if (error instanceof StockArtError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Stock-art request failed", error);
  return NextResponse.json({ error: "Unable to use the stock-art catalog. Please try again." }, { status: 500 });
}

function previewUrl(worldId: string, entry: StockArtManifestEntry, size: "thumb" | "full" = "thumb") {
  return `/api/worlds/${worldId}/stock-art/${entry.id}/${entry.version}/preview?size=${size}`;
}

function filterContext(params: URLSearchParams, purpose: StockArtPurpose | null, recommendedOnly: boolean) {
  return [params.get("q") || "", params.get("collection") || "", params.get("subject") || "", params.get("style") || "", purpose || "", String(recommendedOnly)].join("\u0000");
}

function encodeCursor(revision: string, context: string, offset: number) {
  return Buffer.from(JSON.stringify({ revision, context, offset })).toString("base64url");
}

function decodeCursor(value: string | null, revision: string, context: string) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { revision?: unknown; context?: unknown; offset?: unknown };
    if (parsed.revision !== revision || parsed.context !== context || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error();
    return parsed.offset as number;
  } catch {
    throw new StockArtError("This result page is no longer available. Refresh the stock-art results.", 409);
  }
}

function matches(entry: StockArtManifestEntry, query: string, collection: string, subject: string, style: string, purpose: StockArtPurpose | null, recommendedOnly: boolean) {
  if (collection && entry.collection !== collection) return false;
  if (subject && !entry.subjectTypes.includes(subject as StockArtSubject)) return false;
  if (style && !entry.styleTags.some(tag => tag.toLowerCase() === style.toLowerCase())) return false;
  if (purpose && recommendedOnly) {
    const recommendation = entry.visual.recommendations.find(item => item.purpose === purpose);
    if (!recommendation?.recommended) return false;
  }
  if (!query) return true;
  const haystack = [entry.title, entry.defaultAlt, entry.collection, entry.creator.name, ...entry.styleTags, ...entry.searchTerms].join(" ").toLowerCase();
  return haystack.includes(query);
}

async function getHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: worldId } = await context.params;
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") || "").trim().toLowerCase().slice(0, 200);
    const collection = (params.get("collection") || "").slice(0, 80);
    const subject = (params.get("subject") || "").slice(0, 80);
    const style = (params.get("style") || "").slice(0, 80);
    const rawPurpose = params.get("purpose");
    if (rawPurpose && !STOCK_ART_PURPOSES.includes(rawPurpose as StockArtPurpose)) throw new StockArtError("Choose a supported placement purpose.");
    const purpose = rawPurpose as StockArtPurpose | null;
    const recommendedOnly = params.get("recommendedOnly") === "true";
    if (recommendedOnly && !purpose) throw new StockArtError("Choose a placement purpose before requesting recommended artwork.");

    const { catalog } = await loadStockArtCatalog();
    if (collection && !catalog.collections.some(item => item.id === collection)) throw new StockArtError("Choose an installed collection.");
    if (subject && !STOCK_ART_SUBJECTS.includes(subject as StockArtSubject)) throw new StockArtError("Choose a supported subject type.");

    const filter = filterContext(params, purpose, recommendedOnly);
    const offset = decodeCursor(params.get("cursor"), catalog.catalogRevision, filter);
    const collections = new Map(catalog.collections.map(item => [item.id, item.title]));
    const filtered = catalog.entries
      .filter(entry => isStockArtSelectable(entry) && matches(entry, query, collection, subject, style, purpose, recommendedOnly))
      .sort((a, b) => a.id === b.id ? a.version - b.version : a.id < b.id ? -1 : 1);
    const page = filtered.slice(offset, offset + PAGE_SIZE);
    const savedRows = page.length === 0 ? [] : await prisma.imageAssetProvenance.findMany({
      where: {
        asset: { worldId, archived: false },
        OR: page.map(entry => ({ catalogEntryId: entry.id, catalogVersion: entry.version })),
      },
      select: { catalogEntryId: true, catalogVersion: true, assetId: true },
    });
    const saved = new Map(savedRows.map(row => [`${row.catalogEntryId}@${row.catalogVersion}`, row.assetId]));

    return NextResponse.json({
      catalogRevision: catalog.catalogRevision,
      collections: catalog.collections.map(item => ({ id: item.id, title: item.title })),
      subjects: STOCK_ART_SUBJECTS,
      styles: [...new Set(catalog.entries.filter(isStockArtSelectable).flatMap(entry => entry.styleTags))].sort(),
      total: filtered.length,
      entries: page.map(entry => ({
        id: entry.id,
        version: entry.version,
        collection: entry.collection,
        collectionTitle: collections.get(entry.collection) || entry.collection,
        title: entry.title,
        reviewStatus: hasApprovedStockReview(entry) ? "approved" : "pending",
        subjectTypes: entry.subjectTypes,
        styleTags: entry.styleTags,
        defaultAlt: entry.defaultAlt,
        thumbnailUrl: previewUrl(worldId, entry, "thumb"),
        previewUrl: previewUrl(worldId, entry, "full"),
        credit: {
          text: entry.attribution.creditText,
          required: entry.attribution.required,
          licenseUrl: entry.attribution.licenseUrl,
          sourceUrl: entry.attribution.sourceUrl,
          creatorUrl: entry.attribution.creatorUrl,
        },
        recommendation: purpose ? entry.visual.recommendations.find(item => item.purpose === purpose) ?? null : null,
        saved: saved.has(`${entry.id}@${entry.version}`) ? { assetId: saved.get(`${entry.id}@${entry.version}`) } : null,
      })),
      nextCursor: offset + PAGE_SIZE < filtered.length ? encodeCursor(catalog.catalogRevision, filter, offset + PAGE_SIZE) : null,
    });
  } catch (error) {
    return failure(error);
  }
}

async function postHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: worldId } = await context.params;
    const body = await request.json().catch(() => { throw new StockArtError("Invalid JSON."); });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new StockArtError("Choose an artwork to use.");
    const keys = Object.keys(body);
    if (keys.some(key => !["entryId", "version"].includes(key))) throw new StockArtError("Only a catalog entry ID and version may be selected.");
    if (typeof body.entryId !== "string" || !body.entryId) throw new StockArtError("Choose an artwork to use.");
    if (!Number.isSafeInteger(body.version) || body.version < 1) throw new StockArtError("Choose a valid artwork version.");
    const result = await materializeStockArt(worldId, body.entryId, body.version);
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return failure(error);
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
export const maxDuration = 30;
