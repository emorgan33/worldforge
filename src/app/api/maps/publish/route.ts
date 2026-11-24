import { withAuthor, AccessError, type AuthorizedRoute } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { imageAssetId } from "@/lib/assets";
import { recordAuditEvent } from "@/lib/audit";
import { clearPlayerActivity, recordPlayerActivity } from "@/lib/player-activity";
import {
  buildMapSnapshot,
  normalizeSelection,
  snapshotSelection,
  type MapSnapshot,
  parseMapSnapshot,
  snapshotImageReferences,
} from "@/lib/map-publication";

class PublishError extends Error {
  constructor(message: string, public status = 400, public issues: string[] = []) { super(message); }
}

function failure(error: unknown) {
  if (error instanceof PublishError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: error.status });
  if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Map publication failed:", error);
  return NextResponse.json({ error: "Unable to update map sharing." }, { status: 500 });
}

function requiredId(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new PublishError(`${label} is required.`);
  return value.trim();
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new PublishError("A valid JSON body is required."); }
}

async function worldMap(worldId: string, mapId: string) {
  const map = await prisma.map.findFirst({
    where: { id: mapId, worldId },
    include: {
      layers: { orderBy: { order: "asc" } },
      markers: { orderBy: { createdAt: "asc" } },
      elements: { orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!map) throw new PublishError("Map not found in this world.", 404);
  return map;
}

/** Resolve the local asset behind a map image reference. */
function assetIdFor(value: string): string | null {
  const direct = imageAssetId(value);
  if (direct) return direct;
  try { return imageAssetId(new URL(value).pathname); } catch { return null; }
}

async function imageReadiness(worldId: string, urls: string[]) {
  const assets = new Map<string, string>();
  const issues: string[] = [];
  for (const url of urls) {
    const id = assetIdFor(url);
    if (!id) { issues.push("Every published map image must come from the world's image library."); continue; }
    assets.set(id, url);
  }
  if (assets.size === 0) return { assets, issues };
  const owned = await prisma.imageAsset.findMany({
    where: { id: { in: [...assets.keys()] }, worldId, archived: false },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map(asset => asset.id));
  for (const id of assets.keys()) if (!ownedIds.has(id)) issues.push("A published map image is missing from this world's image library.");
  const policies = await prisma.audiencePolicy.findMany({
    where: { resourceKind: "assets", resourceId: { in: [...ownedIds] } },
    select: { resourceId: true, mode: true },
  });
  const publicIds = new Set(policies.filter(policy => policy.mode === "PUBLIC").map(policy => policy.resourceId));
  for (const id of ownedIds) if (!publicIds.has(id)) issues.push("The map image is not shared with all campaign players yet.");
  return { assets, issues };
}

function publicationSummary(snapshot: MapSnapshot) {
  return {
    title: snapshot.title,
    layers: snapshot.layers.length,
    markers: snapshot.markers.length,
    elements: snapshot.elements.length,
    selection: snapshotSelection(snapshot),
  };
}

async function getHandler(request: NextRequest) {
  try {
    const worldId = requiredId(request.nextUrl.searchParams.get("worldId"), "World ID");
    const mapId = requiredId(request.nextUrl.searchParams.get("mapId"), "Map ID");
    const map = await worldMap(worldId, mapId);
    const publication = await prisma.mapPublication.findUnique({ where: { mapId }, select: { snapshot: true, revision: true, publishedAt: true } });
    const snapshot = parseMapSnapshot(publication?.snapshot);
    const readiness = await imageReadiness(worldId, [map.imageUrl, ...map.layers.map(layer => layer.imageUrl ?? "")].filter(Boolean));
    return NextResponse.json({
      publishedAt: publication?.publishedAt ?? null,
      revision: publication?.revision ?? 0,
      summary: snapshot ? publicationSummary(snapshot) : null,
      imagesReady: readiness.issues.length === 0,
      imageIssues: [...new Set(readiness.issues)],
    });
  } catch (error) { return failure(error); }
}

async function postHandler(request: NextRequest, _context: unknown, { user }: AuthorizedRoute) {
  try {
    const body = await readBody(request);
    const worldId = requiredId(body.worldId, "World ID");
    const mapId = requiredId(body.mapId, "Map ID");
    const map = await worldMap(worldId, mapId);
    let selection;
    try { selection = normalizeSelection(body); }
    catch (error) { throw new PublishError(error instanceof Error ? error.message : "Choose valid map items to publish."); }
    if (selection.layers.length + selection.markers.length + selection.elements.length === 0) {
      throw new PublishError("Choose at least one layer, pin, or annotation to publish.");
    }
    const snapshot = buildMapSnapshot(map, selection);
    const shareImages = body.shareImages !== false;
    const images = [];
    const issues: string[] = [];
    for (const url of snapshotImageReferences(snapshot)) {
      const id = assetIdFor(url);
      if (!id) { issues.push("Every published map image must come from the world's image library."); continue; }
      images.push(id);
    }
    if (issues.length) throw new PublishError("This map uses an image outside the world's library.", 400, [...new Set(issues)]);
    const uniqueImages = [...new Set(images)];
    const owned = await prisma.imageAsset.findMany({ where: { id: { in: uniqueImages }, worldId, archived: false }, select: { id: true } });
    if (owned.length !== uniqueImages.length) throw new PublishError("A published map image is missing from this world's image library.");
    const policies = await prisma.audiencePolicy.findMany({
      where: { resourceKind: "assets", resourceId: { in: uniqueImages } },
      select: { resourceId: true, mode: true },
    });
    const publicIds = new Set(policies.filter(policy => policy.mode === "PUBLIC").map(policy => policy.resourceId));
    const unshared = uniqueImages.filter(id => !publicIds.has(id));
    if (unshared.length && !shareImages) {
      throw new PublishError(
        "This map's images are not shared with campaign players. Share them now, or share each image from the image library first.",
        400,
        ["The map image must be readable by every campaign player."],
      );
    }

    const publication = await prisma.$transaction(async tx => {
      for (const assetId of unshared) {
        const policy = await tx.audiencePolicy.upsert({
          where: { resourceKind_resourceId: { resourceKind: "assets", resourceId: assetId } },
          create: { worldId, resourceKind: "assets", resourceId: assetId, mode: "PUBLIC", createdById: user.id },
          update: { mode: "PUBLIC" },
        });
        await recordAuditEvent({ worldId, resourceKind: "assets", resourceId: assetId, action: "set_policy", actorId: user.id, afterJson: JSON.stringify({ mode: "PUBLIC", reason: "map_publication", mapId }) }, tx);
        await tx.audienceGrant.deleteMany({ where: { policyId: policy.id } });
      }
      const publication = await tx.mapPublication.upsert({
        where: { mapId },
        create: { mapId, snapshot: JSON.stringify(snapshot), publishedById: user.id },
        update: { snapshot: JSON.stringify(snapshot), publishedById: user.id, publishedAt: new Date(), revision: { increment: 1 } },
      });
      // Republishing bumps the map to the top of the players' "What's new" feed.
      await recordPlayerActivity(tx, { worldId, resourceKind: "map", resourceId: mapId });
      return publication;
    });
    await recordAuditEvent({ worldId, resourceKind: "maps", resourceId: mapId, action: "publish_snapshot", actorId: user.id, afterJson: JSON.stringify(publicationSummary(snapshot)) });

    return NextResponse.json({
      success: true,
      publishedAt: publication.publishedAt,
      revision: publication.revision,
      summary: publicationSummary(snapshot),
      imagesShared: unshared.length,
    }, { status: 201 });
  } catch (error) { return failure(error); }
}

async function deleteHandler(request: NextRequest) {
  try {
    const body = await readBody(request);
    const worldId = requiredId(body.worldId, "World ID");
    const mapId = requiredId(body.mapId, "Map ID");
    await worldMap(worldId, mapId);
    await prisma.mapPublication.deleteMany({ where: { mapId } });
    await clearPlayerActivity(prisma, "map", mapId);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
export const POST = withAuthor({ target: "world-body", field: "worldId" }, postHandler);
export const DELETE = withAuthor({ target: "world-body", field: "worldId" }, deleteHandler);
