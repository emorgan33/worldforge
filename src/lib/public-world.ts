import { parseAppearance } from "./world-appearance";
import { prisma } from "./db";
import { publicArticleFilter } from "./publication";
import { parseArticleDocument, publicDocument, publicImage, localAssetId, documentReferences } from "./public-content";
import { articleStatblockKey, articleBlockCategory } from "./article-template-content";
import { getArticleTemplate } from "./templates";
import type { ArticleTemplateType } from "@/types";
import { readerCharacterRows } from "./character-sheet";
import { projectReaderMetadata } from "./metadata-references";
import { articleImageAssetIds } from "./asset-references";
import { readerCreditsForAssets } from "./stock-credits";

export async function publicWorld(slug: string) {
  const world = await prisma.world.findFirst({ where: { slug, isPublic: true, deletedAt: null }, select: { id: true, slug: true, title: true, system: true, description: true, coverImage: true, coverImageAlt: true, bannerImage: true, bannerImageAlt: true, appearance: true } });
  if (!world) return null;
  const [categories, articles, assets] = await Promise.all([
    prisma.category.findMany({ where: { worldId: world.id }, select: { id: true, name: true, parentId: true, order: true, icon: true, iconImage: true }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    prisma.article.findMany({ where: { worldId: world.id, ...publicArticleFilter }, select: { id: true, slug: true, title: true, template: true, excerpt: true, order: true, categoryId: true }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    prisma.imageAsset.findMany({ where: { worldId: world.id, displayRestricted: false }, select: { id: true } }),
  ]);
  const assetIds = new Set(assets.map(asset => asset.id));
  const appearance = parseAppearance(world.appearance);
  appearance.backgroundImage = publicImage(appearance.backgroundImage, assetIds) || "";
  const visibleCategories = categories.map(category => ({ ...category, iconImage: publicImage(category.iconImage, assetIds) }));
  const coverImage = publicImage(world.coverImage, assetIds);
  const decorations = [coverImage, appearance.backgroundImage, ...visibleCategories.map(category => category.iconImage)];
  const credits = await readerCreditsForAssets(world.id, decorations.flatMap(url => { const id = url && localAssetId(url); return id ? [id] : []; }));
  return { ...world, appearance, coverImage, bannerImage: publicImage(world.bannerImage, assetIds), categories: visibleCategories, articles, assetIds, credits };
}
export async function publicArticle(worldSlug: string, articleSlug: string) {
  const world = await publicWorld(worldSlug); if (!world) return null;
  const summary = world.articles.find(article => article.slug === articleSlug); if (!summary) return null;
  const article = await prisma.article.findFirst({ where: { id: summary.id, ...publicArticleFilter, world: { isPublic: true } }, select: { id: true, title: true, template: true, contentJson: true, contentHtml: true, metadata: true, coverImage: true, coverImageAlt: true, portraitImage: true, portraitImageAlt: true } });
  if (!article) return null;
  const blocks = await prisma.rpgBlock.findMany({ where: { worldId: world.id } });
  const doc = publicDocument(parseArticleDocument(article.contentJson, article.contentHtml), world.articles, world.assetIds, new Set(blocks.map(block => block.id)));
  let rawMetadata: Record<string, unknown> = {}; try { const value = JSON.parse(article.metadata || "{}"); if (value && typeof value === "object" && !Array.isArray(value)) rawMetadata = value; } catch {}
  const system = typeof rawMetadata.rulesSystem === "string" ? rawMetadata.rulesSystem : world.system;
  const definition = getArticleTemplate(article.template as ArticleTemplateType, system);
  // Public metadata can reference only blocks already surfaced by this article's
  // public document or its validated article-level statblock link.
  const publicBlockIds = documentReferences(doc, "campaignStatblock", "blockId");
  const linkedId = rawMetadata[articleStatblockKey(system)];
  const linked = blocks.find(block => block.id === linkedId && block.system === system && block.category === articleBlockCategory(article.template));
  if (linked) publicBlockIds.add(linked.id);
  const metadata = projectReaderMetadata(
    rawMetadata,
    definition,
    system,
    new Set(world.articles.map(candidate => candidate.id)),
    publicBlockIds,
  );
  if (article.template === "CHARACTER") Object.assign(metadata, readerCharacterRows(system, rawMetadata));
  if (linked) metadata[articleStatblockKey(system)] = linked.id;
  const usedBlocks = publicBlockIds;
  const ownCover = publicImage(article.coverImage, world.assetIds);
  const coverImage = ownCover || world.bannerImage;
  const coverImageAlt = ownCover ? article.coverImageAlt : world.bannerImageAlt;
  const portraitImage = publicImage(article.portraitImage, world.assetIds);
  const decorations = [world.appearance.backgroundImage, ...world.categories.map(category => category.iconImage)];
  const credits = await readerCreditsForAssets(world.id, [...articleImageAssetIds(doc, coverImage, portraitImage), ...decorations.flatMap(url => { const id = url && localAssetId(url); return id ? [id] : []; })]);
  // Variables remain literal on public pages: private macro collections never enter the reader payload.
  return { world, summary, doc, metadata, system, coverImage, coverImageAlt, portraitImage, portraitImageAlt: article.portraitImageAlt, credits, blocks: blocks.filter(block => usedBlocks.has(block.id)) };
}
export async function assetIsPublic(id: string, worldId: string) {
  const world = await prisma.world.findFirst({ where: { id: worldId, isPublic: true, deletedAt: null }, select: { slug: true, coverImage: true, bannerImage: true, appearance: true } });
  if (!world) return false;
  const ids = new Set([id]);
  const referencesAsset = (value: string | null) => localAssetId(publicImage(value, ids) || "") === id;
  if ([world.coverImage, world.bannerImage, parseAppearance(world.appearance).backgroundImage].some(referencesAsset)) return true;

  const categories = await prisma.category.findMany({ where: { worldId, iconImage: { not: null } }, select: { iconImage: true } });
  if (categories.some(category => referencesAsset(category.iconImage))) return true;

  // Stored encodings cannot safely prefilter parsed image references. Check
  // every published article through the same projection used by the reader.
  const articles = await prisma.article.findMany({
    where: { worldId, ...publicArticleFilter },
    select: { contentJson: true, contentHtml: true, coverImage: true, portraitImage: true },
  });

  return articles.some(article => {
    if (referencesAsset(article.coverImage) || referencesAsset(article.portraitImage)) return true;
    const doc = publicDocument(parseArticleDocument(article.contentJson, article.contentHtml), [], ids, new Set());
    return [...documentReferences(doc, "image", "src")].some(src => localAssetId(src) === id);
  });
}

export async function publicBacklinks(worldId: string, articles: { id: string; title: string }[], targetId: string) {
  const sources = await prisma.article.findMany({ where: { worldId, ...publicArticleFilter }, select: { id: true, contentJson: true, contentHtml: true } });
  return new Set(sources.filter(source => source.id !== targetId && documentReferences(publicDocument(parseArticleDocument(source.contentJson, source.contentHtml), articles, new Set(), new Set()), "articleLink", "articleId").has(targetId)).map(source => source.id));
}
