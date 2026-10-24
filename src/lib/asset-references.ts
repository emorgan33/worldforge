import { prisma } from "./db";
import { assetUrl, imageAssetId } from "./assets";
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
  const url = assetUrl(assetId);
  if (article.coverImage === url || article.portraitImage === url) return true;
  if (!article.contentHtml?.includes(url) && !article.contentJson?.includes(url)) return false;
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

export async function scanAssetReferences(worldId: string, assetId: string): Promise<AssetReferenceSummary> {
  const url = assetUrl(assetId);
  const [world, categories, articleRows] = await Promise.all([
    prisma.world.findUnique({
      where: { id: worldId },
      select: { coverImage: true, bannerImage: true, appearance: true },
    }),
    prisma.category.findMany({ where: { worldId, iconImage: url }, select: { id: true, name: true }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    prisma.article.findMany({
      where: {
        worldId,
        OR: [
          { contentHtml: { contains: url } },
          { contentJson: { contains: url } },
          { coverImage: url },
          { portraitImage: url },
        ],
      },
      select: { id: true, title: true, slug: true, contentJson: true, contentHtml: true, coverImage: true, portraitImage: true, category: { select: { name: true } } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),
  ]);

  const articles = articleRows
    .filter(article => articleReferencesAsset(article, assetId))
    .map((article): AssetReferenceArticle => ({ id: article.id, title: article.title, slug: article.slug, categoryName: article.category?.name ?? null }));

  return {
    worldCover: world?.coverImage === url,
    worldBanner: world?.bannerImage === url,
    worldBackground: appearanceBackground(world?.appearance ?? null) === url,
    categories,
    articles,
  };
}

/** Collapse a summary to a boolean "is still referenced anywhere". */
export function isReferenced(summary: AssetReferenceSummary): boolean {
  return Boolean(summary.worldCover || summary.worldBanner || summary.worldBackground) || summary.categories.length > 0 || summary.articles.length > 0;
}

/**
 * All asset IDs still referenced by any persistent content in a world. Used by
 * cleanup/GC so an archived image that is referenced only through a portrait,
 * a parsed article body, or a category illustration is never removed.
 */
export async function referencedAssetIds(worldId: string): Promise<Set<string>> {
  const [world, categories, articles] = await Promise.all([
    prisma.world.findUnique({ where: { id: worldId }, select: { coverImage: true, bannerImage: true, appearance: true } }),
    prisma.category.findMany({ where: { worldId }, select: { iconImage: true } }),
    prisma.article.findMany({ where: { worldId }, select: { coverImage: true, portraitImage: true, contentJson: true, contentHtml: true } }),
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
    if (article.contentHtml?.includes("/api/assets/") || article.contentJson?.includes("/api/assets/")) {
      const doc = parseArticleDocument(article.contentJson, article.contentHtml);
      for (const src of documentReferences(doc, "image", "src")) add(src);
    }
  }
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
