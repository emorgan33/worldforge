import { AccessError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readAsset } from "@/lib/asset-storage";
import type { WorldExportV1 } from "@/lib/world-export";

export class WorldTransferExportError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) { super(message); }
}

/** Execute the legacy v1 export projection for an owner. */
export async function exportWorldV1(worldId: string, ownerId: string, includeAssets: boolean, includePrivate: boolean): Promise<WorldExportV1> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    select: { id: true, ownerId: true, slug: true, title: true, description: true, genre: true, system: true, isPublic: true, coverImage: true, bannerImage: true, appearance: true },
  });
  if (!world) throw new WorldTransferExportError("World not found", 404);
  if (world.ownerId !== ownerId) throw new AccessError("You do not have access to this world", 403);

  const [categories, articles, assets, statblocks, secrets, timelines, variableCollections, maps] = await Promise.all([
    prisma.category.findMany({ where: { worldId }, orderBy: { order: "asc" } }),
    prisma.article.findMany({ where: { worldId }, orderBy: { createdAt: "asc" } }),
    includeAssets ? prisma.imageAsset.findMany({ where: { worldId } }) : Promise.resolve([]),
    prisma.rpgBlock.findMany({ where: { worldId } }),
    includePrivate ? prisma.secret.findMany({ where: { worldId } }) : Promise.resolve([]),
    prisma.timeline.findMany({ where: { worldId }, include: { events: true } }),
    prisma.variableCollection.findMany({ where: { worldId }, include: { variables: true } }),
    prisma.map.findMany({ where: { worldId }, include: { layers: true, markerGroups: true, markers: true, elements: true } }),
  ]);
  const filteredArticles = includePrivate ? articles : articles.filter(article => article.publicationStatus === "PUBLISHED" && article.visibility === "PUBLIC");
  const exportAssets: WorldExportV1["assets"] = [];
  for (let i = 0; i < assets.length; i += 20) {
    const rows = await Promise.all(assets.slice(i, i + 20).map(async asset => {
      try {
        const data = await readAsset(asset.id);
        return { id: asset.id, title: asset.title, originalName: asset.originalName, alt: asset.alt, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height, sha256: asset.sha256, archived: asset.archived, data: Buffer.from(data).toString("base64") };
      } catch (error) {
        throw new Error(`Could not include asset "${asset.id}" in the backup`, { cause: error });
      }
    }));
    exportAssets.push(...rows);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    world: { ...world, isPublic: false },
    categories: categories.map(category => ({ id: category.id, parentId: category.parentId, name: category.name, icon: category.icon, order: category.order })),
    articles: filteredArticles.map(article => ({ id: article.id, categoryId: article.categoryId, template: article.template, title: article.title, slug: article.slug, excerpt: article.excerpt, contentHtml: article.contentHtml, contentJson: article.contentJson, metadata: article.metadata, tags: article.tags, publicationStatus: includePrivate ? article.publicationStatus : "DRAFT", visibility: includePrivate ? article.visibility : "INHERITED", coverImage: article.coverImage })),
    assets: exportAssets,
    statblocks: statblocks.map(block => ({ id: block.id, category: block.category, name: block.name, system: block.system, statsJson: block.statsJson })),
    secrets: secrets.map(secret => ({ id: secret.id, articleId: secret.articleId, title: secret.title, content: secret.content, isRevealed: secret.isRevealed })),
    timelines: timelines.map(timeline => ({ id: timeline.id, title: timeline.title, description: timeline.description, coverImage: timeline.coverImage, events: timeline.events.map(event => ({ id: event.id, title: event.title, description: event.description, dateDisplay: event.dateDisplay, numericDate: event.numericDate, importance: event.importance, articleId: event.articleId })) })),
    variableCollections: variableCollections.map(collection => ({ id: collection.id, name: collection.name, prefix: collection.prefix, description: collection.description, variables: collection.variables.map(variable => ({ id: variable.id, key: variable.key, title: variable.title, type: variable.type, value: variable.value, description: variable.description })) })),
    maps: maps.map(map => ({ id: map.id, title: map.title, description: map.description, imageUrl: map.imageUrl, width: map.width, height: map.height, defaultZoom: map.defaultZoom, layers: map.layers.map(({ id, name, order, isVisible, imageUrl }) => ({ id, name, order, isVisible, imageUrl })), groups: map.markerGroups.map(({ id, name, color, icon }) => ({ id, name, color, icon })), pins: map.markers.map(({ id, layerId, groupId, title, description, x, y, articleId, icon, color }) => ({ id, layerId, groupId, title, description, x, y, articleId, icon, color })), elements: map.elements.map(({ id, layerId, kind, geometry, style }) => ({ id, layerId, kind, geometry, style })) })),
  };
}
