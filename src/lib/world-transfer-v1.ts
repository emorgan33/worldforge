import { prisma } from "@/lib/db";
import { normalizeImage, removeAssetFile, writeAsset } from "@/lib/asset-storage";
import { randomUUID } from "node:crypto";
import type { WorldExportV1 } from "@/lib/world-export";
import { remapArticleMetadata } from "@/lib/metadata-references";
import { importedWorldSlug, remapWorldAssetUrls, remapWorldReferenceId, worldTransferSlugsValid } from "@/lib/world-transfer-adapters";

export interface WorldTransferExecutionResult {
  worldId: string;
  warnings?: string[];
  imported: { categories: number; articles: number; assets: number; statblocks: number; secrets: number; timelines: number; variableCollections: number };
}

export async function importWorldV1(v1Body: WorldExportV1, ownerId: string, identity?: { worldId: string; assetId(sourceId: string): string; completionRequestId?: string; completionPayloadHash?: string }): Promise<WorldTransferExecutionResult> {
  if (!worldTransferSlugsValid(v1Body)) throw new Error("Invalid or duplicate import slug");
  const warnings: string[] = [];
let slug = v1Body.world.slug;
  let slugSuffix = 0;
  while (await prisma.world.findUnique({ where: { slug }, select: { id: true } })) { slugSuffix++; slug = importedWorldSlug(v1Body.world.slug, slugSuffix); }
  if (slugSuffix > 0) warnings.push(`World slug "${v1Body.world.slug}" was taken; renamed to "${slug}"`);

  const newWorldId = identity?.worldId ?? randomUUID();
  const createdAssetFiles: string[] = [];
  try {
  await prisma.world.create({
    data: { id: newWorldId, slug, title: v1Body.world.title, description: v1Body.world.description, genre: v1Body.world.genre || "Fantasy", system: v1Body.world.system || "DND_5E", isPublic: false, coverImage: null, bannerImage: null, appearance: v1Body.world.appearance, ownerId },
  });

  const categoryIdMap = new Map<string, string>();
  for (const cat of v1Body.categories || []) { categoryIdMap.set(cat.id, randomUUID()); }
  for (const cat of v1Body.categories || []) {
    await prisma.category.create({ data: { id: categoryIdMap.get(cat.id)!, worldId: newWorldId, parentId: null, name: cat.name, icon: cat.icon || "folder", order: cat.order || 0 } });
  }
  for (const cat of v1Body.categories || []) {
    const id = categoryIdMap.get(cat.id); const parentId = cat.parentId ? categoryIdMap.get(cat.parentId) : undefined;
    if (id && parentId) await prisma.category.update({ where: { id }, data: { parentId } });
    else if (id && cat.parentId) warnings.push(`Category "${cat.name}" had a missing parent and was restored at the root`);
  }

  const assetIdMap = new Map<string, string>();
  const assetUrlMap = new Map<string, string>();
  let assetsImported = 0;
  for (const asset of v1Body.assets || []) {
    let writingAssetId: string | null = null;
    let assetFileWritten = false;
    try {
      if (typeof asset.data !== "string" || asset.data.length > 14 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.data)) throw new Error("Invalid or oversized image data");
      const normalized = await normalizeImage(Buffer.from(asset.data, "base64"));
      const newId = identity?.assetId(asset.id) ?? randomUUID();
      writingAssetId = newId;
      await writeAsset(newId, normalized.data); assetFileWritten = true; createdAssetFiles.push(newId);
      await prisma.imageAsset.create({ data: { id: newId, worldId: newWorldId, title: asset.title, originalName: asset.originalName, alt: asset.alt, mimeType: "image/webp", byteSize: normalized.data.length, width: normalized.width, height: normalized.height, sha256: normalized.sha256, archived: asset.archived === true } });
      assetIdMap.set(asset.id, newId);
      assetUrlMap.set(`/api/assets/${asset.id}/file`, `/api/assets/${newId}/file`);
      assetsImported++;
    } catch (e) {
      if (writingAssetId && assetFileWritten) {
        try { await removeAssetFile(writingAssetId); createdAssetFiles.splice(createdAssetFiles.indexOf(writingAssetId), 1); await prisma.assetCleanupJob.deleteMany({ where: { assetId: writingAssetId } }); }
        catch (cleanupError) { await prisma.assetCleanupJob.upsert({ where: { assetId: writingAssetId }, create: { assetId: writingAssetId, lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" }, update: { lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" } }); }
      }
      warnings.push(`Failed to import asset "${asset.title}": ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  const remapUrls = (content: string | null) => remapWorldAssetUrls(content, assetUrlMap, assetId => warnings.push(`Removed reference to unavailable asset "${assetId}"`));
  const remapCategoryId = (categoryId: string | null) => remapWorldReferenceId(categoryId, categoryIdMap);
  const appearance = remapUrls(v1Body.world.appearance);
  if (appearance !== v1Body.world.appearance) await prisma.world.update({ where: { id: newWorldId }, data: { appearance } });

  const articleIdMap = new Map<string, string>((v1Body.articles || []).map(article => [article.id, randomUUID()]));
  const statblockIdMap = new Map<string, string>((v1Body.statblocks || []).map(block => [block.id, randomUUID()]));
  let articlesImported = 0;
  for (const article of v1Body.articles || []) {
    const newId = articleIdMap.get(article.id)!;
    const metadata = remapArticleMetadata(article.metadata, articleIdMap, statblockIdMap, (key, sourceId, kind) => warnings.push(`Removed metadata ${kind} reference "${sourceId}" from ${key}`));
    await prisma.article.create({ data: { id: newId, worldId: newWorldId, categoryId: remapCategoryId(article.categoryId), template: article.template || "GENERIC", title: article.title, slug: article.slug, excerpt: article.excerpt, contentHtml: remapUrls(article.contentHtml), contentJson: remapUrls(article.contentJson), metadata: remapUrls(metadata), tags: article.tags, publicationStatus: "DRAFT", visibility: "PRIVATE", coverImage: article.coverImage ? assetUrlMap.get(article.coverImage) ?? null : null } });
    articlesImported++;
  }

  let statblocksImported = 0;
  for (const block of v1Body.statblocks || []) { await prisma.rpgBlock.create({ data: { id: statblockIdMap.get(block.id)!, worldId: newWorldId, category: block.category, name: block.name, system: block.system, statsJson: block.statsJson } }); statblocksImported++; }

  let secretsImported = 0;
  for (const secret of v1Body.secrets || []) { await prisma.secret.create({ data: { id: randomUUID(), worldId: newWorldId, articleId: secret.articleId ? articleIdMap.get(secret.articleId) ?? null : null, title: secret.title, content: secret.content, isRevealed: false } }); secretsImported++; }

  let timelinesImported = 0;
  for (const timeline of v1Body.timelines || []) {
    await prisma.timeline.create({ data: { id: randomUUID(), worldId: newWorldId, title: timeline.title, description: timeline.description, coverImage: remapUrls(timeline.coverImage), events: { create: timeline.events.map(e => ({ id: randomUUID(), title: e.title, description: e.description, dateDisplay: e.dateDisplay, numericDate: e.numericDate, importance: e.importance, articleId: e.articleId ? articleIdMap.get(e.articleId) ?? null : null })) } } });
    timelinesImported++;
  }

  let variableCollectionsImported = 0;
  for (const vc of v1Body.variableCollections || []) {
    const collectionId = randomUUID();
    await prisma.variableCollection.create({ data: { id: collectionId, worldId: newWorldId, name: vc.name, prefix: vc.prefix, description: vc.description, variables: { create: vc.variables.map(v => ({ id: randomUUID(), key: v.key, title: v.title, type: v.type, value: v.value, description: v.description })) } } });
    variableCollectionsImported++;
  }

  const coverImageUrl = v1Body.world.coverImage ? assetUrlMap.get(v1Body.world.coverImage) ?? null : null;
  const bannerImageUrl = v1Body.world.bannerImage ? assetUrlMap.get(v1Body.world.bannerImage) ?? null : null;
  if (coverImageUrl || bannerImageUrl) { await prisma.world.update({ where: { id: newWorldId }, data: { coverImage: coverImageUrl, bannerImage: bannerImageUrl } }); }

  for (const map of v1Body.maps || []) {
    const layerIds = new Map((map.layers || []).map(layer => [layer.id, randomUUID()]));
    const groupIds = new Map((map.groups || []).map(group => [group.id, randomUUID()]));
    await prisma.map.create({ data: { id: randomUUID(), worldId: newWorldId, title: map.title, description: map.description, imageUrl: remapUrls(map.imageUrl) || "", width: map.width, height: map.height, defaultZoom: map.defaultZoom, layers: { create: (map.layers || []).map(layer => ({ id: layerIds.get(layer.id)!, name: layer.name, order: layer.order, isVisible: layer.isVisible, imageUrl: remapUrls(layer.imageUrl) })) }, markerGroups: { create: (map.groups || []).map(group => ({ id: groupIds.get(group.id)!, name: group.name, color: group.color, icon: group.icon })) }, markers: { create: (map.pins || []).map(pin => ({ id: randomUUID(), layerId: pin.layerId ? layerIds.get(pin.layerId) ?? null : null, groupId: pin.groupId ? groupIds.get(pin.groupId) ?? null : null, title: pin.title, description: pin.description, x: pin.x, y: pin.y, articleId: pin.articleId ? articleIdMap.get(pin.articleId) ?? null : null, icon: pin.icon, color: pin.color })) } } });
  }

  if (identity?.completionRequestId && identity.completionPayloadHash) {
    await prisma.world.update({ where: { id: newWorldId }, data: { creationRequestId: identity.completionRequestId, creationPayloadHash: identity.completionPayloadHash } });
  }
  return { worldId: newWorldId, warnings: warnings.length > 0 ? warnings : undefined, imported: { categories: v1Body.categories?.length || 0, articles: articlesImported, assets: assetsImported, statblocks: statblocksImported, secrets: secretsImported, timelines: timelinesImported, variableCollections: variableCollectionsImported } };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await prisma.$transaction(async tx => {
        await tx.accessAuditEvent.deleteMany({ where: { worldId: newWorldId } });
        await tx.world.deleteMany({ where: { id: newWorldId } });
      });
    } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (!cleanupErrors.length) for (const assetId of createdAssetFiles) {
      try { await removeAssetFile(assetId); await prisma.assetCleanupJob.deleteMany({ where: { assetId } }); }
      catch (cleanupError) {
        try { await prisma.assetCleanupJob.upsert({ where: { assetId }, create: { assetId, lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" }, update: { lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" } }); }
        catch (queueError) { cleanupErrors.push(queueError); }
      }
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "World import failed and rollback cleanup was incomplete", { cause: error });
    throw error;
  }
}
