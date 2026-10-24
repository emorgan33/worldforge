import { withAuthor, sessionUser } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeImage, removeAssetFile, writeAsset } from "@/lib/asset-storage";
import { randomUUID } from "node:crypto";
import type { WorldExport } from "@/app/api/worlds/[id]/export/route";
import type { WorldExportV2 } from "@/lib/world-export";
import { importWorldV2 } from "@/lib/world-export";
import { remapArticleMetadata } from "@/lib/metadata-references";

export interface ImportResult {
  success: boolean;
  worldId?: string;
  error?: string;
  warnings?: string[];
  imported: { categories: number; articles: number; assets: number; statblocks: number; secrets: number; timelines: number; variableCollections: number; };
}

const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
async function readBoundedJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BUNDLE_BYTES) throw new Error("Import bundle exceeds the 60 MB limit");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Import bundle is empty");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BUNDLE_BYTES) { await reader.cancel(); throw new Error("Import bundle exceeds the 60 MB limit"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function validateBundleShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bundle = value as Record<string, unknown>;
  const world = bundle.world as Record<string, unknown> | null;
  if (!world || typeof world !== "object" || typeof world.title !== "string" || typeof world.slug !== "string" || world.title.length > 200 || world.slug.length > 120) return false;
  for (const key of ["categories", "articles", "articleRevisions", "assets", "statblocks", "secrets", "timelines", "variableCollections", "members", "audiencePolicies", "audienceGrants", "auditEvents", "sessions", "sessionEntityLinks", "maps"]) {
    const section = bundle[key];
    if (section !== undefined && (!Array.isArray(section) || section.length > 10000)) return false;
  }
  if (Array.isArray(bundle.assets) && bundle.assets.some((asset) => !asset || typeof asset !== "object" || typeof (asset as { data?: unknown }).data !== "string" || (asset as { data: string }).data.length > 14 * 1024 * 1024)) return false;
  return true;
}

export const POST = withAuthor(async (request: Request) => {
  const warnings: string[] = [];
  try {
    const user = await sessionUser();
    if (!user) throw new AccessError("You must be signed in", 401);

    let body: unknown;
    try { body = await readBoundedJson(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid JSON file" }, { status: 400 }); }
    if (!validateBundleShape(body)) return NextResponse.json({ error: "Import file is malformed or exceeds supported section limits" }, { status: 400 });

    // Detect format version. Formats 2 and 3 share the rich v2 importer; v3
    // additionally carries image provenance and placement/restriction fields.
    const formatVersion = body && typeof body === "object" && "formatVersion" in body ? (body as Record<string, unknown>).formatVersion : undefined;
    const isV2 = formatVersion === 2 || formatVersion === 3;

    if (isV2) {
      const v2Result = await importWorldV2(
        body as unknown as WorldExportV2,
        user.id,
        async (slug: string) => !!(await prisma.world.findUnique({ where: { slug }, select: { id: true } }))
      );
      if (!v2Result.success) return NextResponse.json({ error: v2Result.error || "Failed to import world" }, { status: 500 });
      return NextResponse.json({
        success: true,
        worldId: v2Result.worldId,
        warnings: v2Result.warnings,
        imported: v2Result.imported,
      });
    }

    const v1Body = body as unknown as WorldExport;
    if (!v1Body.version || v1Body.version !== 1) return NextResponse.json({ error: "Unsupported export format version" }, { status: 400 });
    if (v1Body.assets?.some(asset => "provenance" in asset)) {
      return NextResponse.json({ error: "Format 1 cannot preserve image provenance. Import a format 3 bundle instead." }, { status: 400 });
    }
    if (!v1Body.world?.title || !v1Body.world?.slug) return NextResponse.json({ error: "Export file is missing world information" }, { status: 400 });

    let slug = v1Body.world.slug;
    let slugSuffix = 0;
    while (await prisma.world.findUnique({ where: { slug }, select: { id: true } })) { slugSuffix++; slug = `${v1Body.world.slug}-${slugSuffix}`; }
    if (slugSuffix > 0) warnings.push(`World slug "${v1Body.world.slug}" was taken; renamed to "${slug}"`);

    const newWorldId = randomUUID();
    const createdAssetFiles: string[] = [];
    try {
    await prisma.world.create({
      data: { id: newWorldId, slug, title: v1Body.world.title, description: v1Body.world.description, genre: v1Body.world.genre || "Fantasy", system: v1Body.world.system || "DND_5E", isPublic: false, coverImage: null, bannerImage: null, appearance: v1Body.world.appearance, ownerId: user.id },
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
        const newId = randomUUID();
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

    function remapUrls(content: string | null): string | null { if (!content) return content; let result = content; for (const [oldUrl, newUrl] of assetUrlMap) { result = result.split(oldUrl).join(newUrl); } const known = new Set(assetUrlMap.values()); return result.replace(/\/api\/assets\/([0-9a-f-]{36})\/file/gi, (match, assetId: string) => { if (known.has(match)) return match; warnings.push(`Removed reference to unavailable asset "${assetId}"`); return ""; }); }
    function remapCategoryId(categoryId: string | null): string | null { if (!categoryId) return null; return categoryIdMap.get(categoryId) ?? null; }
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

    return NextResponse.json({ success: true, worldId: newWorldId, warnings: warnings.length > 0 ? warnings : undefined, imported: { categories: v1Body.categories?.length || 0, articles: articlesImported, assets: assetsImported, statblocks: statblocksImported, secrets: secretsImported, timelines: timelinesImported, variableCollections: variableCollectionsImported } });
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
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to import world:", error);
    return NextResponse.json({ error: "Failed to import world" }, { status: 500 });
  }
});
