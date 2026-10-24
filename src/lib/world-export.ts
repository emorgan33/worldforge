import { prisma } from "@/lib/db";
import { readAsset, writeAsset } from "@/lib/asset-storage";
import { randomUUID } from "node:crypto";
import { normalizeImage, removeAssetFile } from "@/lib/asset-storage";
import { provenanceVerificationOrigin, validateImportedStockSnapshot } from "./stock-provenance";
import { collectHtmlReferences } from "@/lib/article-mention-index";
import { collectJsonReferences } from "@/lib/article-links";
import type { JSONContent } from "@tiptap/core";

// ---------------------------------------------------------------------------
// v1 Manifest (re-exported for type checking)
// ---------------------------------------------------------------------------
export interface WorldExportV1 {
  version: 1;
  exportedAt: string;
  world: {
    id: string; slug: string; title: string; description: string | null;
    genre: string; system: string; isPublic: boolean;
    coverImage: string | null; bannerImage: string | null; appearance: string | null;
  };
  categories: { id: string; parentId: string | null; name: string; icon: string; order: number }[];
  articles: {
    id: string; categoryId: string | null; template: string; title: string;
    slug: string; excerpt: string | null; contentHtml: string | null;
    contentJson: string | null; metadata: string | null; tags: string | null;
    publicationStatus: string; visibility: string; coverImage: string | null;
  }[];
  assets: {
    id: string; title: string; originalName: string; alt: string;
    mimeType: string; byteSize: number; width: number; height: number;
    sha256: string; data: string; archived?: boolean;
  }[];
  statblocks: { id: string; category: string; name: string; system: string; statsJson: string }[];
  secrets: { id: string; articleId: string | null; title: string; content: string; isRevealed: boolean }[];
  timelines: {
    id: string; title: string; description: string | null; coverImage: string | null;
    events: { id: string; title: string; description: string; dateDisplay: string; numericDate: number; importance: number; articleId: string | null }[];
  }[];
  variableCollections: {
    id: string; name: string; prefix: string; description: string | null;
    variables: { id: string; key: string; title: string | null; type: string; value: string; description: string | null }[];
  }[];
  maps?: WorldExportMap[];
}
export interface WorldExportMap {
  id: string; title: string; description: string | null; imageUrl: string;
  width: number; height: number; defaultZoom: number;
  layers: { id: string; name: string; order: number; isVisible: boolean; imageUrl: string | null }[];
  pins: { id: string; layerId: string | null; groupId: string | null; title: string; description: string | null; x: number; y: number; articleId: string | null; icon: string | null; color: string | null }[];
  groups: { id: string; name: string; color: string; icon: string }[];
  elements: { id: string; layerId: string | null; kind: string; geometry: string; style: string | null }[];
}
// ---------------------------------------------------------------------------
// v2 Manifest
// ---------------------------------------------------------------------------
export interface WorldExportV2 {
  formatVersion: 2;
  exportedAt: string;
  sourceWorldId: string | null;
  world: {
    id: string; slug: string; title: string; description: string | null;
    genre: string; system: string; isPublic: boolean;
    coverImage: string | null; bannerImage: string | null; appearance: string | null;
    coverImageAlt?: string | null; bannerImageAlt?: string | null;
  };
  categories: { id: string; parentId: string | null; name: string; icon: string; order: number; iconImage?: string | null }[];
  articles: {
    id: string; categoryId: string | null; template: string; title: string;
    slug: string; excerpt: string | null; contentHtml: string | null;
    contentJson: string | null; metadata: string | null; tags: string | null;
    publicationStatus: string; visibility: string; coverImage: string | null;
    portraitImage: string | null; parentId: string | null; order: number;
    coverImageAlt?: string | null; portraitImageAlt?: string | null;
    sidebarJson?: string | null; version?: number; state?: string;
    isPinned: boolean; wordCount: number; canonState: string;
    revealedInSessionId: string | null; supersededById: string | null;
  }[];
  articleRevisions?: {
    id: string; articleId: string; title: string; slug: string; excerpt: string | null;
    contentHtml: string | null; contentJson: string | null; metadata: string | null;
    tags: string | null; publicationStatus: string; visibility: string; state: string;
    userId: string; savedAt: string; articleVersionAtSave: number; createdAt: string;
    coverImage?: string | null; coverImageAlt?: string | null;
    portraitImage?: string | null; portraitImageAlt?: string | null;
  }[];
  assets: {
    id: string; title: string; originalName: string; alt: string;
    mimeType: string; byteSize: number; width: number; height: number;
    sha256: string; data: string; archived?: boolean;
    source?: string; displayRestricted?: boolean;
    restrictionReason?: string | null; restrictionDate?: string | null;
    provenance?: {
      catalogEntryId: string; catalogVersion: number; manifestDigest: string;
      snapshotJson: string; verificationOrigin: string;
    }[];
  }[];
  statblocks: { id: string; category: string; name: string; system: string; statsJson: string }[];
  secrets: { id: string; articleId: string | null; title: string; content: string; isRevealed: boolean }[];
  timelines: {
    id: string; title: string; description: string | null; coverImage: string | null;
    events: { id: string; title: string; description: string; dateDisplay: string; numericDate: number; importance: number; articleId: string | null }[];
  }[];
  variableCollections: {
    id: string; name: string; prefix: string; description: string | null;
    variables: { id: string; key: string; title: string | null; type: string; value: string; description: string | null }[];
  }[];
  // New v2 sections
  members: {
    id: string; userId: string; role: string; status: string;
    joinedAt: string; revokedAt: string | null;
  }[];
  audiencePolicies: {
    id: string; resourceKind: string; resourceId: string;
    mode: string; createdAt: string;
  }[];
  audienceGrants: {
    id: string; policyId: string; userId: string;
    grantedAt: string; revokedAt: string | null;
  }[];
  auditEvents: {
    id: string; action: string; resourceKind: string | null;
    resourceId: string | null; actorId: string | null;
    beforeJson: string | null; afterJson: string | null;
    parentEventId: string | null; createdAt: string;
  }[];
  sessions: {
    id: string; title: string; description: string | null;
    sessionDate: string | null; inWorldDate: string | null;
    currentLocation: string | null; status: string;
    recap: string | null; nextPrep: string | null;
    order: number; isNext: boolean;
    createdAt: string; updatedAt: string;
  }[];
  sessionEntityLinks: {
    id: string; sessionId: string; kind: string;
    entityId: string; label: string | null; order: number;
  }[];
  maps?: WorldExportMap[];
}
/**
 * Portable world bundle format 3. Adds stock-art provenance, per-placement alt
 * text, category illustrations, revision image fields and operator restrictions
 * to the v2 bundle. v1/v2 imports remain supported.
 */
export interface WorldExportV3 extends Omit<WorldExportV2, "formatVersion"> {
  formatVersion: 3;
}
// ---------------------------------------------------------------------------
// Export function (v2)
// ---------------------------------------------------------------------------
export async function exportWorldV2(worldId: string): Promise<WorldExportV2> {
  return buildWorldExport(worldId, 2) as Promise<WorldExportV2>;
}

/** Complete owner backup including provenance, placement fields and restrictions. */
export async function exportWorldV3(worldId: string): Promise<WorldExportV3> {
  return buildWorldExport(worldId, 3) as Promise<WorldExportV3>;
}

/**
 * True when a world can only be represented losslessly by format 3 (it has
 * provenance/restrictions or placement alt/illustration data). Legacy v1/v2
 * exports of such a world are refused instead of silently dropping it.
 */
export async function worldNeedsV3(worldId: string): Promise<boolean> {
  const [world, article, revision, category, provenance, restricted] = await Promise.all([
    prisma.world.findUnique({ where: { id: worldId }, select: { coverImageAlt: true, bannerImageAlt: true } }),
    prisma.article.findFirst({ where: { worldId, OR: [{ coverImageAlt: { not: null } }, { portraitImageAlt: { not: null } }] }, select: { id: true } }),
    prisma.articleRevision.findFirst({ where: { article: { worldId }, OR: [{ coverImage: { not: null } }, { portraitImage: { not: null } }, { coverImageAlt: { not: null } }, { portraitImageAlt: { not: null } }] }, select: { id: true } }),
    prisma.category.findFirst({ where: { worldId, iconImage: { not: null } }, select: { id: true } }),
    prisma.imageAssetProvenance.findFirst({ where: { asset: { worldId } }, select: { id: true } }),
    prisma.imageAsset.findFirst({ where: { worldId, displayRestricted: true }, select: { id: true } }),
  ]);
  return Boolean((world && (world.coverImageAlt !== null || world.bannerImageAlt !== null)) || article || revision || category || provenance || restricted);
}

async function buildWorldExport(worldId: string, formatVersion: 2 | 3): Promise<WorldExportV2 | WorldExportV3> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    select: {
      id: true, slug: true, title: true, description: true,
      genre: true, system: true, isPublic: true,
      coverImage: true, bannerImage: true, appearance: true,
      coverImageAlt: true, bannerImageAlt: true,
    },
  });
  if (!world) throw new Error("World not found");

  const [
    categories,
    articles,
    articleRevisions,
    assets,
    statblocks,
    secrets,
    timelines,
    variableCollections,
    members,
    audiencePolicies,
    audienceGrants,
    auditEvents,
    sessions,
    sessionEntityLinks,
    maps,
  ] = await Promise.all([
    prisma.category.findMany({ where: { worldId }, orderBy: { order: "asc" } }),
    prisma.article.findMany({ where: { worldId }, orderBy: { createdAt: "asc" } }),
    prisma.articleRevision.findMany({ where: { article: { worldId } }, orderBy: { savedAt: "asc" } }),
    prisma.imageAsset.findMany({ where: { worldId }, include: { provenance: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } }),
    prisma.rpgBlock.findMany({ where: { worldId } }),
    prisma.secret.findMany({ where: { worldId } }),
    prisma.timeline.findMany({ where: { worldId }, include: { events: true } }),
    prisma.variableCollection.findMany({ where: { worldId }, include: { variables: true } }),
    prisma.worldMember.findMany({ where: { worldId } }),
    prisma.audiencePolicy.findMany({ where: { worldId } }),
    prisma.audienceGrant.findMany({ where: { policy: { worldId } } }),
    prisma.accessAuditEvent.findMany({ where: { worldId }, orderBy: { createdAt: "asc" } }),
    prisma.campaignSession.findMany({ where: { worldId }, orderBy: { order: "asc" } }),
    prisma.sessionEntityLink.findMany({ where: { worldId }, orderBy: { order: "asc" } }),
    prisma.map.findMany({ where: { worldId }, include: { layers: true, markerGroups: true, markers: true, elements: true } }),
  ]);
  // Read asset data in batches
  const CHUNK_SIZE = 20;
  const exportAssets: (WorldExportV2["assets"][number] | null)[] = [];
  for (let i = 0; i < assets.length; i += CHUNK_SIZE) {
    const chunk = assets.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (asset) => {
        try {
          const data = await readAsset(asset.id);
          return {
            id: asset.id, title: asset.title, originalName: asset.originalName,
            alt: asset.alt, mimeType: asset.mimeType, byteSize: asset.byteSize,
            width: asset.width, height: asset.height, sha256: asset.sha256, archived: asset.archived,
            source: asset.source,
            displayRestricted: asset.displayRestricted,
            restrictionReason: asset.restrictionReason,
            restrictionDate: asset.restrictionDate?.toISOString() ?? null,
            provenance: asset.provenance.map(entry => ({
              catalogEntryId: entry.catalogEntryId, catalogVersion: entry.catalogVersion,
              manifestDigest: entry.manifestDigest, snapshotJson: entry.snapshotJson,
              verificationOrigin: provenanceVerificationOrigin(entry.verificationOrigin, entry.snapshotJson),
            })),
            data: Buffer.from(data).toString("base64"),
          };
        } catch (error) {
          throw new Error(`Could not include asset "${asset.id}" in the backup`, { cause: error });
        }
      })
    );
    for (const r of results) exportAssets.push(r);
  }

  return {
    formatVersion,
    exportedAt: new Date().toISOString(),
    sourceWorldId: worldId,
    world: { ...world, isPublic: false },
    categories: categories.map((c) => ({
      id: c.id, parentId: c.parentId, name: c.name, icon: c.icon, order: c.order, iconImage: c.iconImage,
    })),
    articles: articles.map((a) => ({
      id: a.id, categoryId: a.categoryId, template: a.template,
      title: a.title, slug: a.slug, excerpt: a.excerpt,
      contentHtml: a.contentHtml, contentJson: a.contentJson,
      sidebarJson: a.sidebarJson, version: a.version, state: a.state,
      metadata: a.metadata, tags: a.tags,
      publicationStatus: a.publicationStatus, visibility: a.visibility,
      coverImage: a.coverImage, portraitImage: a.portraitImage,
      coverImageAlt: a.coverImageAlt, portraitImageAlt: a.portraitImageAlt,
      parentId: a.parentId, order: a.order, isPinned: a.isPinned,
      wordCount: a.wordCount, canonState: a.canonState,
      revealedInSessionId: a.revealedInSessionId,
      supersededById: a.supersededById,
    })),
    articleRevisions: articleRevisions.map(revision => ({
      id: revision.id, articleId: revision.articleId, title: revision.title,
      slug: revision.slug, excerpt: revision.excerpt, contentHtml: revision.contentHtml,
      contentJson: revision.contentJson, metadata: revision.metadata, tags: revision.tags,
      publicationStatus: revision.publicationStatus, visibility: revision.visibility,
      state: revision.state, userId: revision.userId,
      savedAt: revision.savedAt.toISOString(), articleVersionAtSave: revision.articleVersionAtSave,
      createdAt: revision.createdAt.toISOString(),
      coverImage: revision.coverImage, coverImageAlt: revision.coverImageAlt,
      portraitImage: revision.portraitImage, portraitImageAlt: revision.portraitImageAlt,
    })),
    assets: exportAssets.filter(Boolean) as WorldExportV2["assets"],
    statblocks: statblocks.map((s) => ({
      id: s.id, category: s.category, name: s.name,
      system: s.system, statsJson: s.statsJson,
    })),
    secrets: secrets.map((s) => ({
      id: s.id, articleId: s.articleId, title: s.title,
      content: s.content, isRevealed: s.isRevealed,
    })),
    timelines: timelines.map((t) => ({
      id: t.id, title: t.title, description: t.description,
      coverImage: t.coverImage,
      events: t.events.map((e) => ({
        id: e.id, title: e.title, description: e.description,
        dateDisplay: e.dateDisplay, numericDate: e.numericDate,
        importance: e.importance, articleId: e.articleId,
      })),
    })),
    variableCollections: variableCollections.map((vc) => ({
      id: vc.id, name: vc.name, prefix: vc.prefix, description: vc.description,
      variables: vc.variables.map((v) => ({
        id: v.id, key: v.key, title: v.title, type: v.type,
        value: v.value, description: v.description,
      })),
    })),
    members: members.map((m) => ({
      id: m.id, userId: m.userId, role: m.role, status: m.status,
      joinedAt: m.joinedAt.toISOString(),
      revokedAt: m.revokedAt?.toISOString() ?? null,
    })),
    audiencePolicies: audiencePolicies.map((ap) => ({
      id: ap.id, resourceKind: ap.resourceKind, resourceId: ap.resourceId,
      mode: ap.mode, createdAt: ap.createdAt.toISOString(),
    })),
    audienceGrants: audienceGrants.map((ag) => ({
      id: ag.id, policyId: ag.policyId, userId: ag.userId,
      grantedAt: ag.grantedAt.toISOString(),
      revokedAt: ag.revokedAt?.toISOString() ?? null,
    })),
    auditEvents: auditEvents.map((ae) => ({
      id: ae.id, action: ae.action,
      resourceKind: ae.resourceKind, resourceId: ae.resourceId,
      actorId: ae.actorId,
      beforeJson: ae.beforeJson, afterJson: ae.afterJson,
      parentEventId: ae.parentEventId,
      createdAt: ae.createdAt.toISOString(),
    })),
    sessions: sessions.map((s) => ({
      id: s.id, title: s.title, description: s.description,
      sessionDate: s.sessionDate?.toISOString() ?? null,
      inWorldDate: s.inWorldDate ?? null,
      currentLocation: s.currentLocation ?? null,
      status: s.status, recap: s.recap ?? null,
      nextPrep: s.nextPrep ?? null,
      order: s.order, isNext: s.isNext,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    sessionEntityLinks: sessionEntityLinks.map((sel) => ({
      id: sel.id, sessionId: sel.sessionId, kind: sel.kind,
      entityId: sel.entityId, label: sel.label, order: sel.order,
    })),
    maps: maps.map((map) => ({
      id: map.id, title: map.title, description: map.description, imageUrl: map.imageUrl,
      width: map.width, height: map.height, defaultZoom: map.defaultZoom,
      layers: map.layers.map(({ id, name, order, isVisible, imageUrl }) => ({ id, name, order, isVisible, imageUrl })),
      groups: map.markerGroups.map(({ id, name, color, icon }) => ({ id, name, color, icon })),
      pins: map.markers.map(({ id, layerId, groupId, title, description, x, y, articleId, icon, color }) => ({ id, layerId, groupId, title, description, x, y, articleId, icon, color })),
      elements: map.elements.map(({ id, layerId, kind, geometry, style }) => ({ id, layerId, kind, geometry, style })),
    })),
  };
}
// ---------------------------------------------------------------------------
// Import result types
// ---------------------------------------------------------------------------
const MAX_IMPORTED_SNAPSHOT_BYTES = 64 * 1024;
const IMPORTED_ASSET_SOURCES = new Set(["UPLOADED", "STOCK", "IMPORTED"]);

function normalizeImportedSource(value: unknown): string {
  return typeof value === "string" && IMPORTED_ASSET_SOURCES.has(value) ? value : "IMPORTED";
}

/**
 * Validate imported provenance before writing it, and mark it as an imported
 * declaration: an imported catalog id is never treated as proof of review.
 * Malformed required provenance aborts that asset rather than importing it as
 * an ordinary uncredited upload.
 */
function normalizeImportedProvenance(asset: WorldExportV2["assets"][number]) {
  if (asset.provenance === undefined) return [];
  if (!Array.isArray(asset.provenance) || asset.provenance.length > 25) throw new Error("Invalid provenance record");
  return asset.provenance.map((entry) => {
    const valid = entry && typeof entry === "object"
      && typeof entry.catalogEntryId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.catalogEntryId)
      && Number.isSafeInteger(entry.catalogVersion) && entry.catalogVersion >= 1
      && typeof entry.manifestDigest === "string" && entry.manifestDigest.length > 0 && entry.manifestDigest.length <= 128
      && typeof entry.snapshotJson === "string" && Buffer.byteLength(entry.snapshotJson) <= MAX_IMPORTED_SNAPSHOT_BYTES;
    if (!valid) throw new Error("Malformed provenance record; refusing to import the artwork as an uncredited upload");
    validateImportedStockSnapshot(entry.snapshotJson, entry.catalogEntryId, entry.catalogVersion);
    return {
      catalogEntryId: entry.catalogEntryId,
      catalogVersion: entry.catalogVersion,
      manifestDigest: entry.manifestDigest,
      snapshotJson: entry.snapshotJson,
      verificationOrigin: "IMPORTED_DECLARATION",
    };
  });
}

export interface ImportV2Result {
  success: boolean;
  worldId?: string;
  error?: string;
  warnings?: string[];
  imported: {
    categories: number; articles: number; assets: number;
    statblocks: number; secrets: number; timelines: number;
    variableCollections: number; members: number;
    audiencePolicies: number; audienceGrants: number;
    auditEvents: number; sessions: number; sessionEntityLinks: number;
  };
}
// ---------------------------------------------------------------------------
// Import function (v2)
// ---------------------------------------------------------------------------
export async function importWorldV2(
  data: WorldExportV2 | WorldExportV3,
  ownerUserId: string,
  existingSlugCheck: (slug: string) => Promise<boolean>
): Promise<ImportV2Result> {
  const warnings: string[] = [];
  const articleIdMap = new Map((data.articles || []).map((article) => [article.id, randomUUID()]));
  const statblockIdMap = new Map((data.statblocks || []).map((block) => [block.id, randomUUID()]));
  const secretIdMap = new Map((data.secrets || []).map((secret) => [secret.id, randomUUID()]));
  const mapIdMap = new Map((data.maps || []).map((map) => [map.id, randomUUID()]));
  const collectionIdMap = new Map((data.variableCollections || []).map((collection) => [collection.id, randomUUID()]));
  const variableIdMap = new Map((data.variableCollections || []).flatMap((collection) => collection.variables.map((variable) => [variable.id, randomUUID()] as const)));
  const sessionIdMap = new Map((data.sessions || []).map((session) => [session.id, randomUUID()]));
  let slug = data.world.slug;
  let slugSuffix = 0;
  while (await existingSlugCheck(slug)) { slugSuffix++; slug = `${data.world.slug}-${slugSuffix}`; }
  if (slugSuffix > 0) warnings.push(`World slug "${data.world.slug}" was taken; renamed to "${slug}"`);

  const newWorldId = randomUUID();
  const createdAssetFiles: string[] = [];
  try {
  await prisma.world.create({
    data: {
      id: newWorldId, slug, title: data.world.title,
      description: data.world.description,
      genre: data.world.genre || "Fantasy",
      system: data.world.system || "DND_5E",
      isPublic: false, coverImage: null, bannerImage: null,
      coverImageAlt: data.world.coverImageAlt ?? null, bannerImageAlt: data.world.bannerImageAlt ?? null,
      appearance: data.world.appearance,
      ownerId: ownerUserId,
    },
  });

  const categoryIdMap = new Map<string, string>();
  for (const cat of data.categories || []) { categoryIdMap.set(cat.id, randomUUID()); }
  for (const cat of data.categories || []) {
    await prisma.category.create({
      data: {
        id: categoryIdMap.get(cat.id)!, worldId: newWorldId,
        parentId: null,
        name: cat.name, icon: cat.icon || "folder", order: cat.order || 0,
      },
    });
  }
  for (const cat of data.categories || []) {
    const id = categoryIdMap.get(cat.id);
    if (id && cat.parentId) {
      const parentId = categoryIdMap.get(cat.parentId);
      if (parentId) await prisma.category.update({ where: { id }, data: { parentId } });
      else warnings.push(`Category "${cat.name}" had a missing parent and was restored at the root`);
    }
  }

  const assetIdMap = new Map<string, string>();
  const assetUrlMap = new Map<string, string>();
  let assetsImported = 0;
  for (const asset of data.assets || []) {
    let writingAssetId: string | null = null;
    let assetFileWritten = false;
    try {
      if (typeof asset.data !== "string" || asset.data.length > 14 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.data)) throw new Error("Invalid or oversized image data");
      const decoded = Buffer.from(asset.data, "base64");
      const normalized = await normalizeImage(decoded);
      const newId = randomUUID();
      writingAssetId = newId;
      const provenanceRows = normalizeImportedProvenance(asset);
      await writeAsset(newId, normalized.data);
      assetFileWritten = true;
      createdAssetFiles.push(newId);
      if (typeof asset.sha256 === "string" && asset.sha256 && asset.sha256 !== normalized.sha256) {
        warnings.push(`Image "${asset.title}" was re-encoded on import (source digest ${asset.sha256.slice(0, 12)}… stored as ${normalized.sha256.slice(0, 12)}…); the provenance chain is retained.`);
      }
      await prisma.$transaction(async transaction => {
        await transaction.imageAsset.create({
          data: {
            id: newId, worldId: newWorldId, title: asset.title,
            originalName: asset.originalName, alt: asset.alt,
            mimeType: "image/webp", byteSize: normalized.data.length,
            width: normalized.width, height: normalized.height, sha256: normalized.sha256, archived: asset.archived === true,
            source: normalizeImportedSource(asset.source),
            displayRestricted: asset.displayRestricted === true,
            restrictionReason: asset.displayRestricted === true ? (asset.restrictionReason ?? null) : null,
            restrictionDate: asset.displayRestricted === true && asset.restrictionDate ? new Date(asset.restrictionDate) : null,
          },
        });
        if (provenanceRows.length) await transaction.imageAssetProvenance.createMany({ data: provenanceRows.map(row => ({ ...row, assetId: newId })) });
      });
      assetIdMap.set(asset.id, newId);
      assetUrlMap.set(`/api/assets/${asset.id}/file`, `/api/assets/${newId}/file`);
      assetsImported++;
    } catch (e) {
      if (writingAssetId && assetFileWritten) {
        try { await removeAssetFile(writingAssetId); createdAssetFiles.splice(createdAssetFiles.indexOf(writingAssetId), 1); await prisma.assetCleanupJob.deleteMany({ where: { assetId: writingAssetId } }); }
        catch (cleanupError) {
          await prisma.assetCleanupJob.upsert({ where: { assetId: writingAssetId }, create: { assetId: writingAssetId, lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" }, update: { lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" } });
        }
      }
      warnings.push(`Failed to import asset "${asset.title}": ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  // Restore category illustrations only after asset remapping is known.
  for (const cat of data.categories || []) {
    if (!cat.iconImage) continue;
    const id = categoryIdMap.get(cat.id);
    if (!id) continue;
    const remapped = assetUrlMap.get(cat.iconImage) ?? null;
    if (remapped) await prisma.category.update({ where: { id }, data: { iconImage: remapped } });
    else warnings.push(`Category "${cat.name}" illustration referenced an unavailable image and was cleared`);
  }

  function remapUrls(c: string | null): string | null {
    if (!c) return c;
    let r = c;
    for (const [o, n] of assetUrlMap) r = r.split(o).join(n);
    const validAssetUrls = new Set(assetUrlMap.values());
    return r.replace(/\/api\/assets\/([0-9a-f-]{36})\/file/gi, (match, assetId: string) => {
      if (validAssetUrls.has(match)) return match;
      warnings.push(`Removed reference to unavailable asset "${assetId}"`);
      return "";
    });
  }
  function remapArticleHtml(html: string | null): string | null {
    const articleRemapped = remapUrls(html)?.replace(/data-article-id=(['"])([^'"]+)\1/gi, (_match, quote: string, sourceId: string) => {
      const targetId = articleIdMap.get(sourceId);
      if (!targetId) { warnings.push(`Removed reference to unavailable article "${sourceId}"`); return `data-article-id=${quote}${quote}`; }
      return `data-article-id=${quote}${targetId}${quote}`;
    }) ?? null;
    return articleRemapped?.replace(/data-statblock-id=(['"])([^'"]+)\1/gi, (_match, quote: string, sourceId: string) => {
      const targetId = statblockIdMap.get(sourceId);
      if (!targetId) { warnings.push(`Removed reference to unavailable statblock "${sourceId}"`); return `data-statblock-id=${quote}${quote}`; }
      return `data-statblock-id=${quote}${targetId}${quote}`;
    }) ?? null;
  }
  function remapArticleJson(json: string | null): string | null {
    if (!json) return json;
    try {
      const parsed: unknown = JSON.parse(json);
      function visit(value: unknown): void {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const node = value as Record<string, unknown>;
        if (node.type === "articleLink" && node.attrs && typeof node.attrs === "object") {
          const attrs = node.attrs as Record<string, unknown>;
          if (typeof attrs.articleId === "string") {
            const targetId = articleIdMap.get(attrs.articleId);
            if (targetId) attrs.articleId = targetId;
            else { warnings.push(`Removed reference to unavailable article "${attrs.articleId}"`); attrs.articleId = ""; }
          }
        }
        if (node.type === "campaignStatblock" && node.attrs && typeof node.attrs === "object") {
          const attrs = node.attrs as Record<string, unknown>;
          if (typeof attrs.blockId === "string") attrs.blockId = statblockIdMap.get(attrs.blockId) ?? "";
        }
        for (const [key, item] of Object.entries(node)) {
          if (key.endsWith("StatblockId") && typeof item === "string") node[key] = statblockIdMap.get(item) ?? "";
        }
        Object.values(node).forEach(visit);
      }
      visit(parsed);
      return remapUrls(JSON.stringify(parsed));
    } catch { return remapUrls(json); }
  }
  function remapCatId(categoryId: string | null): string | null {
    return categoryId ? categoryIdMap.get(categoryId) ?? null : null;
  }
  const remappedAppearance = remapUrls(data.world.appearance);
  if (remappedAppearance !== data.world.appearance) await prisma.world.update({ where: { id: newWorldId }, data: { appearance: remappedAppearance } });
  let articlesImported = 0;
  for (const article of data.articles || []) {
    const newId = articleIdMap.get(article.id)!;
    await prisma.article.create({
      data: {
        id: newId, worldId: newWorldId,
        categoryId: remapCatId(article.categoryId),
        template: article.template || "GENERIC",
        title: article.title, slug: article.slug,
        excerpt: article.excerpt,
        contentHtml: remapArticleHtml(article.contentHtml),
        contentJson: remapArticleJson(article.contentJson),
        sidebarJson: remapArticleJson(article.sidebarJson ?? null),
        metadata: remapArticleJson(article.metadata),
        tags: article.tags,
        publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT",
        coverImage: article.coverImage ? assetUrlMap.get(article.coverImage) ?? null : null,
        portraitImage: article.portraitImage ? assetUrlMap.get(article.portraitImage) ?? null : null,
        coverImageAlt: article.coverImageAlt ?? null,
        portraitImageAlt: article.portraitImageAlt ?? null,
        parentId: null,
        order: article.order || 0, isPinned: article.isPinned || false,
        wordCount: article.wordCount || 0, canonState: article.canonState || "GM_DRAFT", version: Math.max(1, article.version || 1),
        revealedInSessionId: null, supersededById: null,
      },
    });
    articlesImported++;
  }

  for (const article of data.articles || []) {
    if (!article.parentId) continue;
    const id = articleIdMap.get(article.id); const parentId = articleIdMap.get(article.parentId);
    if (id && parentId) await prisma.article.update({ where: { id }, data: { parentId } });
    else if (id) warnings.push(`Article "${article.title}" had a missing parent and was restored at the root`);
  }

  // Rebuild graph edges after all article IDs are available. Legacy backups
  // did not contain mention rows, so indexing the remapped content also keeps
  // old v2 bundles compatible. Batch writes avoid one full-world scan per
  // article when a large campaign is restored.
  const importedTitles = new Map<string, string[]>();
  const importedById = new Map<string, string>();
  for (const article of data.articles || []) {
    const id = articleIdMap.get(article.id)!;
    importedById.set(id, article.title);
    importedTitles.set(article.title, [...(importedTitles.get(article.title) ?? []), id]);
  }
  const mentionRows: { sourceArticleId: string; targetArticleId: string; mentionText: string }[] = [];
  for (const article of data.articles || []) {
    const sourceId = articleIdMap.get(article.id)!;
    const contentJson = remapArticleJson(article.contentJson);
    let doc: JSONContent | null = null;
    if (contentJson) { try { doc = JSON.parse(contentJson) as JSONContent; } catch { /* HTML fallback */ } }
    const refs = doc?.type === "doc" && Array.isArray(doc.content)
      ? collectJsonReferences(doc) : collectHtmlReferences(remapArticleHtml(article.contentHtml) ?? "");
    const targets = new Set(refs.ids);
    for (const title of refs.titles) {
      const matches = importedTitles.get(title);
      if (matches?.length === 1) targets.add(matches[0]);
    }
    for (const targetId of targets) {
      if (targetId !== sourceId && importedById.has(targetId)) mentionRows.push({ sourceArticleId: sourceId, targetArticleId: targetId, mentionText: importedById.get(targetId)! });
    }
  }
  for (let i = 0; i < mentionRows.length; i += 500) await prisma.articleMention.createMany({ data: mentionRows.slice(i, i + 500) });

  if (data.articleRevisions?.length) warnings.push("Revision authors were assigned to the importing account");
  for (const revision of data.articleRevisions || []) {
    const articleId = articleIdMap.get(revision.articleId);
    if (!articleId) { warnings.push(`Skipped revision for unavailable article "${revision.articleId}"`); continue; }
    await prisma.articleRevision.create({ data: {
      id: randomUUID(), articleId, title: revision.title, slug: revision.slug,
      excerpt: revision.excerpt, contentHtml: remapArticleHtml(revision.contentHtml),
      contentJson: remapArticleJson(revision.contentJson), metadata: remapArticleJson(revision.metadata),
      tags: revision.tags, publicationStatus: revision.publicationStatus,
      visibility: revision.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE", state: revision.state, userId: ownerUserId,
      savedAt: new Date(revision.savedAt), articleVersionAtSave: revision.articleVersionAtSave,
      createdAt: new Date(revision.createdAt),
      coverImage: revision.coverImage ? assetUrlMap.get(revision.coverImage) ?? null : null,
      coverImageAlt: revision.coverImageAlt ?? null,
      portraitImage: revision.portraitImage ? assetUrlMap.get(revision.portraitImage) ?? null : null,
      portraitImageAlt: revision.portraitImageAlt ?? null,
    } });
  }

  // Remap supersededBy after all articles exist
  for (const article of data.articles || []) {
    if (article.supersededById) {
      const newId = articleIdMap.get(article.id);
      const newSup = articleIdMap.get(article.supersededById);
      if (newId && newSup) await prisma.article.update({ where: { id: newId }, data: { supersededById: newSup } });
    }
  }

  let statblocksImported = 0;
  for (const block of data.statblocks || []) {
    await prisma.rpgBlock.create({ data: { id: statblockIdMap.get(block.id)!, worldId: newWorldId, category: block.category, name: block.name, system: block.system, statsJson: block.statsJson } });
    statblocksImported++;
  }

  let secretsImported = 0;
  for (const secret of data.secrets || []) {
    await prisma.secret.create({ data: { id: secretIdMap.get(secret.id)!, worldId: newWorldId, articleId: secret.articleId ? articleIdMap.get(secret.articleId) ?? null : null, title: secret.title, content: secret.content, isRevealed: false } });
    secretsImported++;
  }

  let timelinesImported = 0;
  for (const timeline of data.timelines || []) {
    await prisma.timeline.create({ data: { id: randomUUID(), worldId: newWorldId, title: timeline.title, description: timeline.description, coverImage: remapUrls(timeline.coverImage), events: { create: timeline.events.map(e => ({ id: randomUUID(), title: e.title, description: e.description, dateDisplay: e.dateDisplay, numericDate: e.numericDate, importance: e.importance, articleId: e.articleId ? articleIdMap.get(e.articleId) ?? null : null })) } } });
    timelinesImported++;
  }

  let variableCollectionsImported = 0;
  for (const vc of data.variableCollections || []) {
    const collectionId = collectionIdMap.get(vc.id)!;
    await prisma.variableCollection.create({ data: { id: collectionId, worldId: newWorldId, name: vc.name, prefix: vc.prefix, description: vc.description, variables: { create: vc.variables.map(v => ({ id: variableIdMap.get(v.id)!, key: v.key, title: v.title, type: v.type, value: v.value, description: v.description })) } } });
    variableCollectionsImported++;
  }

  const coverImageUrl = data.world.coverImage ? assetUrlMap.get(data.world.coverImage) ?? null : null;
  const bannerImageUrl = data.world.bannerImage ? assetUrlMap.get(data.world.bannerImage) ?? null : null;
  if (coverImageUrl || bannerImageUrl) {
    await prisma.world.update({ where: { id: newWorldId }, data: { coverImage: coverImageUrl, bannerImage: bannerImageUrl } });
  }
  // Account identities are installation-local. Keep only identities that
  // actually exist here, and never reactivate access from a backup.
  const referencedUsers = [...new Set([
    ...(data.members || []).map(member => member.userId),
    ...(data.audienceGrants || []).map(grant => grant.userId),
    ...(data.auditEvents || []).map(event => event.actorId).filter((id): id is string => !!id),
  ])];
  const localUsers = new Set((await prisma.user.findMany({ where: { id: { in: referencedUsers } }, select: { id: true } })).map(user => user.id));

  // --- Members (imported as inactive) ---
  let membersImported = 0;
  for (const member of data.members || []) {
    if (!localUsers.has(member.userId)) { warnings.push(`Skipped membership for unavailable account "${member.userId}"`); continue; }
    await prisma.worldMember.create({
      data: {
        id: randomUUID(), worldId: newWorldId,
        userId: member.userId, role: member.role || "PLAYER",
        status: "REVOKED", joinedAt: new Date(member.joinedAt), revokedAt: new Date(),
      },
    });
    membersImported++;
  }

  const policyIdMap = new Map<string, string>();
  for (const ap of data.audiencePolicies || []) { policyIdMap.set(ap.id, randomUUID()); }

  let audiencePoliciesImported = 0;
  for (const ap of data.audiencePolicies || []) {
    const newPolicyId = policyIdMap.get(ap.id)!;
    const resourceMap = ({
      articles: articleIdMap, statblocks: statblockIdMap, secrets: secretIdMap,
      maps: mapIdMap, collection: collectionIdMap, variable: variableIdMap,
      assets: assetIdMap, campaign_sessions: sessionIdMap,
    } as Record<string, Map<string, string>>)[ap.resourceKind];
    const resourceId = resourceMap?.get(ap.resourceId);
    if (!resourceId) { policyIdMap.delete(ap.id); warnings.push(`Skipped audience policy for missing or unsupported ${ap.resourceKind} resource "${ap.resourceId}"`); continue; }
    await prisma.audiencePolicy.create({
      data: { id: newPolicyId, worldId: newWorldId, resourceKind: ap.resourceKind, resourceId, mode: ap.mode, createdAt: new Date(ap.createdAt) },
    });
    audiencePoliciesImported++;
  }

  let audienceGrantsImported = 0;
  for (const ag of data.audienceGrants || []) {
    const newPolicyId = policyIdMap.get(ag.policyId);
    if (!newPolicyId) continue;
    if (!localUsers.has(ag.userId)) { warnings.push(`Skipped audience grant for unavailable account "${ag.userId}"`); continue; }
    await prisma.audienceGrant.create({
      data: { id: randomUUID(), policyId: newPolicyId, userId: ag.userId, grantedAt: new Date(ag.grantedAt), revokedAt: new Date() },
    });
    audienceGrantsImported++;
  }

  let auditEventsImported = 0;
  for (const ae of data.auditEvents || []) {
    let resourceId = ae.resourceId;
    if (ae.resourceKind && ae.resourceId) {
      const resourceMap = ({ articles: articleIdMap, statblocks: statblockIdMap, secrets: secretIdMap, maps: mapIdMap, collection: collectionIdMap, variable: variableIdMap, assets: assetIdMap, campaign_sessions: sessionIdMap } as Record<string, Map<string, string>>)[ae.resourceKind];
      if (resourceMap?.has(ae.resourceId)) resourceId = resourceMap.get(ae.resourceId)!;
    }
    await prisma.accessAuditEvent.create({
      data: { id: randomUUID(), worldId: newWorldId, action: ae.action, resourceKind: ae.resourceKind, resourceId, actorId: ae.actorId && localUsers.has(ae.actorId) ? ae.actorId : null, beforeJson: ae.beforeJson, afterJson: ae.afterJson, parentEventId: ae.parentEventId, createdAt: new Date(ae.createdAt) },
    });
    auditEventsImported++;
  }

  let sessionsImported = 0;
  for (const session of data.sessions || []) {
    const newSessionId = sessionIdMap.get(session.id)!;
    await prisma.campaignSession.create({
      data: { id: newSessionId, worldId: newWorldId, title: session.title, description: session.description, sessionDate: session.sessionDate ? new Date(session.sessionDate) : null, inWorldDate: session.inWorldDate ?? null, currentLocation: session.currentLocation ?? null, status: session.status || "PLANNED", recap: session.recap ?? null, nextPrep: session.nextPrep ?? null, order: session.order || 0, isNext: session.isNext || false, createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) },
    });
    sessionsImported++;
  }

  let sessionEntityLinksImported = 0;
  for (const sel of data.sessionEntityLinks || []) {
    const newSessionId = sessionIdMap.get(sel.sessionId);
    if (!newSessionId) continue;
    const entityMap = sel.kind === "article" ? articleIdMap : sel.kind === "statblock" ? statblockIdMap : undefined;
    const newEntityId = entityMap?.get(sel.entityId);
    if (!newEntityId) { warnings.push(`Skipped session link to missing ${sel.kind} entity "${sel.entityId}"`); continue; }
    await prisma.sessionEntityLink.create({
      data: { id: randomUUID(), sessionId: newSessionId, worldId: newWorldId, kind: sel.kind, entityId: newEntityId, label: sel.label, order: sel.order || 0 },
    });
    sessionEntityLinksImported++;
  }

  const allLayerIds = new Set((data.maps || []).flatMap((map) => (map.layers || []).map((layer) => layer.id)));
  const allGroupIds = new Set((data.maps || []).flatMap((map) => (map.groups || []).map((group) => group.id)));
  for (const map of data.maps || []) {
    const mapId = mapIdMap.get(map.id)!;
    const layerIdMap = new Map((map.layers || []).map((layer) => [layer.id, randomUUID()]));
    const groupIdMap = new Map((map.groups || []).map((group) => [group.id, randomUUID()]));
    const pins = (map.pins || []).map((pin) => {
      if (pin.layerId && !layerIdMap.has(pin.layerId) && allLayerIds.has(pin.layerId)) warnings.push(`Skipped cross-map layer reference for pin "${pin.title}"`);
      if (pin.groupId && !groupIdMap.has(pin.groupId) && allGroupIds.has(pin.groupId)) warnings.push(`Skipped cross-map marker group reference for pin "${pin.title}"`);
      return { id: randomUUID(), layerId: pin.layerId ? layerIdMap.get(pin.layerId) ?? null : null, groupId: pin.groupId ? groupIdMap.get(pin.groupId) ?? null : null, title: pin.title, description: pin.description, x: pin.x, y: pin.y, articleId: pin.articleId ? articleIdMap.get(pin.articleId) ?? null : null, icon: pin.icon, color: pin.color };
    });
    const elements = (map.elements || []).map((element) => {
      if (element.layerId && !layerIdMap.has(element.layerId) && allLayerIds.has(element.layerId)) warnings.push(`Skipped cross-map layer reference for a "${element.kind.toLowerCase()}" annotation`);
      return { id: randomUUID(), layerId: element.layerId ? layerIdMap.get(element.layerId) ?? null : null, kind: element.kind, geometry: element.geometry, style: element.style };
    });
    await prisma.map.create({ data: {
      id: mapId, worldId: newWorldId, title: map.title, description: map.description,
      imageUrl: remapUrls(map.imageUrl) || "", width: map.width, height: map.height, defaultZoom: map.defaultZoom,
      layers: { create: (map.layers || []).map((layer) => ({ id: layerIdMap.get(layer.id)!, name: layer.name, order: layer.order, isVisible: layer.isVisible, imageUrl: remapUrls(layer.imageUrl) })) },
      markerGroups: { create: (map.groups || []).map((group) => ({ id: groupIdMap.get(group.id)!, name: group.name, color: group.color, icon: group.icon })) },
      markers: { create: pins },
      elements: { create: elements },
    } });
  }

  // Link revealedInSession for articles
  for (const article of data.articles || []) {
    if (article.revealedInSessionId) {
      const newArticleId = articleIdMap.get(article.id);
      const newSessionId = sessionIdMap.get(article.revealedInSessionId);
      if (newArticleId && newSessionId) {
        await prisma.article.update({
          where: { id: newArticleId },
          data: { revealedInSessionId: newSessionId },
        });
      }
    }
  }

  return {
    success: true,
    worldId: newWorldId,
    warnings: warnings.length > 0 ? warnings : undefined,
    imported: {
      categories: data.categories?.length || 0,
      articles: articlesImported,
      assets: assetsImported,
      statblocks: statblocksImported,
      secrets: secretsImported,
      timelines: timelinesImported,
      variableCollections: variableCollectionsImported,
      members: membersImported,
      audiencePolicies: audiencePoliciesImported,
      audienceGrants: audienceGrantsImported,
      auditEvents: auditEventsImported,
      sessions: sessionsImported,
      sessionEntityLinks: sessionEntityLinksImported,
    },
  };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        await tx.accessAuditEvent.deleteMany({ where: { worldId: newWorldId } });
        await tx.world.deleteMany({ where: { id: newWorldId } });
      });
    } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (!cleanupErrors.length) {
      for (const assetId of createdAssetFiles) {
        try {
          await removeAssetFile(assetId);
          await prisma.assetCleanupJob.deleteMany({ where: { assetId } });
        } catch (cleanupError) {
          try {
            await prisma.assetCleanupJob.upsert({ where: { assetId }, create: { assetId, lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" }, update: { lastError: cleanupError instanceof Error ? cleanupError.message : "Asset cleanup failed" } });
          } catch (queueError) { cleanupErrors.push(queueError); }
        }
      }
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "World import failed and rollback cleanup was incomplete", { cause: error });
    throw error;
  }
}
