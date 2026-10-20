import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readAsset } from "@/lib/asset-storage";
import { exportWorldV2 } from "@/lib/world-export";

export interface WorldExport {
  version: 1;
  exportedAt: string;
  world: { id: string; slug: string; title: string; description: string | null; genre: string; system: string; isPublic: boolean; coverImage: string | null; bannerImage: string | null; appearance: string | null; };
  categories: { id: string; parentId: string | null; name: string; icon: string; order: number }[];
  articles: { id: string; categoryId: string | null; template: string; title: string; slug: string; excerpt: string | null; contentHtml: string | null; contentJson: string | null; metadata: string | null; tags: string | null; publicationStatus: string; visibility: string; coverImage: string | null; }[];
  assets: { id: string; title: string; originalName: string; alt: string; mimeType: string; byteSize: number; width: number; height: number; sha256: string; data: string; archived?: boolean; }[];
  statblocks: { id: string; category: string; name: string; system: string; statsJson: string }[];
  secrets: { id: string; articleId: string | null; title: string; content: string; isRevealed: boolean }[];
  timelines: { id: string; title: string; description: string | null; coverImage: string | null; events: { id: string; title: string; description: string; dateDisplay: string; numericDate: number; importance: number; articleId: string | null; }[]; }[];
  variableCollections: { id: string; name: string; prefix: string; description: string | null; variables: { id: string; key: string; title: string | null; type: string; value: string; description: string | null; }[]; }[];
  maps?: import("@/lib/world-export").WorldExportMap[];
}

function failure(error: unknown) {
  if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Failed to export world:", error);
  return NextResponse.json({ error: "Failed to export world" }, { status: 500 });
}

export const GET = withAuthor(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const includeAssets = url.searchParams.get("includeAssets") !== "false";
    const includePrivate = url.searchParams.get("includePrivate") !== "false";
    const format = url.searchParams.get("format");

    // When format=v2, use the new v2 export function
    if (format === "v2") {
      const exportData = await exportWorldV2(id);
      return NextResponse.json(exportData, {
        headers: {
          "Content-Disposition": `attachment; filename="${exportData.world.slug}-export-v2.json"`,
          "Accept-Version": "2",
        },
      });
    }

    const world = await prisma.world.findUnique({
      where: { id },
      select: { id: true, ownerId: true, slug: true, title: true, description: true, genre: true, system: true, isPublic: true, coverImage: true, bannerImage: true, appearance: true },
    });

    if (!world) return NextResponse.json({ error: "World not found" }, { status: 404 });
    const user = await import("@/lib/auth").then(m => m.sessionUser());
    if (user?.id !== world.ownerId) throw new AccessError("You do not have access to this world", 403);

    const [categories, articles, assets, statblocks, secrets, timelines, variableCollections, maps] = await Promise.all([
      prisma.category.findMany({ where: { worldId: id }, orderBy: { order: "asc" } }),
      prisma.article.findMany({ where: { worldId: id }, orderBy: { createdAt: "asc" } }),
      includeAssets ? prisma.imageAsset.findMany({ where: { worldId: id } }) : Promise.resolve([]),
      prisma.rpgBlock.findMany({ where: { worldId: id } }),
      includePrivate ? prisma.secret.findMany({ where: { worldId: id } }) : Promise.resolve([]),
      prisma.timeline.findMany({ where: { worldId: id }, include: { events: true } }),
      prisma.variableCollection.findMany({ where: { worldId: id }, include: { variables: true } }),
      prisma.map.findMany({ where: { worldId: id }, include: { layers: true, markerGroups: true, markers: true } }),
    ]);

    const filteredArticles = includePrivate ? articles : articles.filter(a => a.publicationStatus === "PUBLISHED" && a.visibility === "PUBLIC");

    // TODO: Player exports need a separate sanitized format (no reuse of GM backup endpoint)
    // Player-facing exports should only include resources the player has access to,
    // using requireReadableResource/canReadEntity to filter data.
    // Read assets in batches to avoid filesystem I/O contention
    const CHUNK_SIZE = 20;
    const exportAssets: (WorldExport["assets"][number] | null)[] = [];
    for (let i = 0; i < assets.length; i += CHUNK_SIZE) {
      const chunk = assets.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(chunk.map(async (asset) => {
        try {
          const data = await readAsset(asset.id);
          return { id: asset.id, title: asset.title, originalName: asset.originalName, alt: asset.alt, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height, sha256: asset.sha256, archived: asset.archived, data: Buffer.from(data).toString("base64") };
        } catch (error) { throw new Error(`Could not include asset "${asset.id}" in the backup`, { cause: error }); }
      }));
      for (const r of results) exportAssets.push(r);
    }

    const exportData: WorldExport = {
      version: 1, exportedAt: new Date().toISOString(),
      world: { ...world, isPublic: false },
      categories: categories.map(c => ({ id: c.id, parentId: c.parentId, name: c.name, icon: c.icon, order: c.order })),
      articles: filteredArticles.map(a => ({ id: a.id, categoryId: a.categoryId, template: a.template, title: a.title, slug: a.slug, excerpt: a.excerpt, contentHtml: a.contentHtml, contentJson: a.contentJson, metadata: a.metadata, tags: a.tags, publicationStatus: includePrivate ? a.publicationStatus : "DRAFT", visibility: includePrivate ? a.visibility : "INHERITED", coverImage: a.coverImage })),
      assets: exportAssets.filter(Boolean) as WorldExport["assets"],
      statblocks: statblocks.map(s => ({ id: s.id, category: s.category, name: s.name, system: s.system, statsJson: s.statsJson })),
      secrets: secrets.map(s => ({ id: s.id, articleId: s.articleId, title: s.title, content: s.content, isRevealed: s.isRevealed })),
      timelines: timelines.map(t => ({ id: t.id, title: t.title, description: t.description, coverImage: t.coverImage, events: t.events.map(e => ({ id: e.id, title: e.title, description: e.description, dateDisplay: e.dateDisplay, numericDate: e.numericDate, importance: e.importance, articleId: e.articleId })) })),
      variableCollections: variableCollections.map(vc => ({ id: vc.id, name: vc.name, prefix: vc.prefix, description: vc.description, variables: vc.variables.map(v => ({ id: v.id, key: v.key, title: v.title, type: v.type, value: v.value, description: v.description })) })),
      maps: maps.map(map => ({ id: map.id, title: map.title, description: map.description, imageUrl: map.imageUrl, width: map.width, height: map.height, defaultZoom: map.defaultZoom, layers: map.layers.map(({ id, name, order, isVisible, imageUrl }) => ({ id, name, order, isVisible, imageUrl })), groups: map.markerGroups.map(({ id, name, color, icon }) => ({ id, name, color, icon })), pins: map.markers.map(({ id, layerId, groupId, title, description, x, y, articleId, icon, color }) => ({ id, layerId, groupId, title, description, x, y, articleId, icon, color })) })),
    };

    return NextResponse.json(exportData, { headers: { "Content-Disposition": `attachment; filename="${world.slug}-export.json"` } });
  } catch (error) { return failure(error); }
});
