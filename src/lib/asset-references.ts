import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import { imageAssetId } from "./assets";
import { documentReferences, localAssetId, parseArticleDocument } from "./public-content";

export interface AssetReferenceArticle {
  id: string;
  title: string;
  slug: string;
  categoryName: string | null;
}

export interface AssetReferenceCategory {
  id: string;
  name: string;
}

/**
 * Every persistent reference to an image asset inside one world. The scan is
 * exhaustive (no page-size cap) so callers can block accidental deletion of an
 * asset that is still referenced deep in a large world.
 */
export interface AssetReferenceSummary {
  worldCover: boolean;
  worldBanner: boolean;
  worldBackground: boolean;
  categories: AssetReferenceCategory[];
  articles: AssetReferenceArticle[];
  revisions: number;
  maps: number;
  mapLayers: number;
  timelines: number;
}

interface ArticleReferenceRow {
  id: string;
  title: string;
  slug: string;
  contentJson: string | null;
  contentHtml: string | null;
  coverImage: string | null;
  portraitImage: string | null;
  category: { name: string } | null;
}

/**
 * True when an article permanently references an asset through its cover,
 * portrait, or body content. Body matches are confirmed against the parsed
 * document so a substring in prose cannot produce a false positive.
 */
export function articleReferencesAsset(article: ArticleReferenceRow, assetId: string): boolean {
  if ((article.coverImage && localAssetId(article.coverImage) === assetId) || (article.portraitImage && localAssetId(article.portraitImage) === assetId)) return true;
  const doc = parseArticleDocument(article.contentJson, article.contentHtml);
  return [...documentReferences(doc, "image", "src")].some(src => localAssetId(src) === assetId);
}

function appearanceBackground(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && typeof parsed.backgroundImage === "string" ? parsed.backgroundImage : null;
  } catch {
    return null;
  }
}

type AssetReferenceClient = Pick<Prisma.TransactionClient, "world" | "category" | "article" | "articleRevision" | "map" | "mapLayer" | "timeline">;

export async function scanAssetReferences(worldId: string, assetId: string, client: AssetReferenceClient = prisma): Promise<AssetReferenceSummary> {
  const [world, categories, articleRows, revisionRows, maps, mapLayers, timelines] = await Promise.all([
    client.world.findUnique({
      where: { id: worldId },
      select: { coverImage: true, bannerImage: true, appearance: true },
    }),
    client.category.findMany({ where: { worldId, iconImage: { not: null } }, select: { id: true, name: true, iconImage: true }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    client.article.findMany({
      where: { worldId },
      select: { id: true, title: true, slug: true, contentJson: true, contentHtml: true, coverImage: true, portraitImage: true, category: { select: { name: true } } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),
    client.articleRevision.findMany({
      where: { article: { worldId } },
      select: { coverImage: true, portraitImage: true, contentHtml: true, contentJson: true },
    }),
    client.map.findMany({ where: { worldId }, select: { imageUrl: true } }),
    client.mapLayer.findMany({ where: { map: { worldId }, imageUrl: { not: null } }, select: { imageUrl: true } }),
    client.timeline.findMany({ where: { worldId }, select: { coverImage: true } }),
  ]);

  const matchingCategories = categories.filter(category => category.iconImage && localAssetId(category.iconImage) === assetId)
    .map(({ id, name }): AssetReferenceCategory => ({ id, name }));
  const articles = articleRows
    .filter(article => articleReferencesAsset(article, assetId))
    .map((article): AssetReferenceArticle => ({ id: article.id, title: article.title, slug: article.slug, categoryName: article.category?.name ?? null }));

  const revisions = revisionRows.filter(revision => {
    if ((revision.coverImage && localAssetId(revision.coverImage) === assetId) || (revision.portraitImage && localAssetId(revision.portraitImage) === assetId)) return true;
    const doc = parseArticleDocument(revision.contentJson, revision.contentHtml);
    return [...documentReferences(doc, "image", "src")].some(src => localAssetId(src) === assetId);
  }).length;
  const timelineReferences = timelines.filter(timeline => timeline.coverImage && localAssetId(timeline.coverImage) === assetId).length;
  const mapReferences = maps.filter(map => localAssetId(map.imageUrl) === assetId).length;
  const mapLayerReferences = mapLayers.filter(layer => layer.imageUrl && localAssetId(layer.imageUrl) === assetId).length;
  const background = appearanceBackground(world?.appearance ?? null);

  return {
    worldCover: Boolean(world?.coverImage && localAssetId(world.coverImage) === assetId),
    worldBanner: Boolean(world?.bannerImage && localAssetId(world.bannerImage) === assetId),
    worldBackground: Boolean(background && localAssetId(background) === assetId),
    categories: matchingCategories,
    articles,
    revisions,
    maps: mapReferences,
    mapLayers: mapLayerReferences,
    timelines: timelineReferences,
  };
}

/** Collapse a summary to a boolean "is still referenced anywhere". */
export function isReferenced(summary: AssetReferenceSummary): boolean {
  return Boolean(summary.worldCover || summary.worldBanner || summary.worldBackground) || summary.categories.length > 0 || summary.articles.length > 0 || summary.revisions > 0 || summary.maps > 0 || summary.mapLayers > 0 || summary.timelines > 0;
}

/**
 * All asset IDs still referenced by any persistent content in a world. Used by
 * cleanup/GC so an archived image that is referenced only through a portrait,
 * a parsed article body, or a category illustration is never removed.
 */
export async function referencedAssetIds(worldId: string): Promise<Set<string>> {
  const [world, categories, articles, revisions, maps, mapLayers, timelines] = await Promise.all([
    prisma.world.findUnique({ where: { id: worldId }, select: { coverImage: true, bannerImage: true, appearance: true } }),
    prisma.category.findMany({ where: { worldId }, select: { iconImage: true } }),
    prisma.article.findMany({ where: { worldId }, select: { coverImage: true, portraitImage: true, contentJson: true, contentHtml: true } }),
    prisma.articleRevision.findMany({ where: { article: { worldId } }, select: { coverImage: true, portraitImage: true, contentJson: true, contentHtml: true } }),
    prisma.map.findMany({ where: { worldId }, select: { imageUrl: true } }),
    prisma.mapLayer.findMany({ where: { map: { worldId } }, select: { imageUrl: true } }),
    prisma.timeline.findMany({ where: { worldId }, select: { coverImage: true } }),
  ]);
  const ids = new Set<string>();
  const add = (value: string | null | undefined) => { const id = value ? localAssetId(value) : null; if (id) ids.add(id); };
  add(world?.coverImage);
  add(world?.bannerImage);
  add(appearanceBackground(world?.appearance ?? null));
  for (const category of categories) add(category.iconImage);
  for (const article of articles) {
    add(article.coverImage);
    add(article.portraitImage);
    const doc = parseArticleDocument(article.contentJson, article.contentHtml);
    for (const src of documentReferences(doc, "image", "src")) add(src);
  }
  for (const revision of revisions) {
    add(revision.coverImage);
    add(revision.portraitImage);
    const doc = parseArticleDocument(revision.contentJson, revision.contentHtml);
    for (const src of documentReferences(doc, "image", "src")) add(src);
  }
  for (const map of maps) add(map.imageUrl);
  for (const layer of mapLayers) add(layer.imageUrl);
  for (const timeline of timelines) add(timeline.coverImage);
  return ids;
}

/** Asset IDs referenced by a reader-facing article, in a stable order. */
export function articleImageAssetIds(
  doc: Parameters<typeof documentReferences>[0],
  ...references: (string | null | undefined)[]
): string[] {
  const ids = new Set<string>();
  for (const reference of references) {
    if (typeof reference !== "string") continue;
    const id = imageAssetId(reference) || localAssetId(reference);
    if (id) ids.add(id);
  }
  for (const src of documentReferences(doc, "image", "src")) {
    const id = localAssetId(src);
    if (id) ids.add(id);
  }
  return [...ids];
}
