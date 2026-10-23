import type { Prisma } from "@prisma/client";
import { withAuthor, AccessError } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isImageReference } from "@/lib/assets";

class MapError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function failure(error: unknown) {
  if (error instanceof MapError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Map request failed:", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the map." }, { status: 500 });
}
async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new MapError("A valid JSON body is required."); }
}
function requiredString(value: unknown, label: string, max = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new MapError(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
function optionalString(value: unknown, label: string, max = 1000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new MapError(`${label} must be at most ${max} characters.`);
  return value.trim();
}
function nullableId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value) throw new MapError("Invalid reference.");
  return value;
}
function numberPercent(value: unknown, label: string) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new MapError(`${label} must be a number.`);
  return Math.max(0, Math.min(100, n));
}
function positiveInt(value: unknown, label: string, fallback: number) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) throw new MapError(`${label} must be a positive integer.`);
  return n;
}

// Only drawings are validated here; labels carry a text payload instead of
// coordinates. Geometry is stored as a JSON string of percentage coordinates.
function parseGeometry(kind: string, geometry: unknown): string {
  if (typeof geometry !== "string" || !geometry.trim() || geometry.length > 1_000_000) throw new MapError("Geometry is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(geometry); }
  catch { throw new MapError("Geometry must be valid JSON."); }
  if (kind === "LABEL") {
    const g = parsed as { x?: unknown; y?: unknown; text?: unknown };
    if (!g || typeof g !== "object" || typeof g.text !== "string" || !g.text.trim() || g.text.length > 2000) throw new MapError("Labels need text.");
    numberPercent(g.x, "Label x"); numberPercent(g.y, "Label y");
  } else if (kind === "LINE") {
    const g = parsed as { x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown };
    if (!g || typeof g !== "object") throw new MapError("Line geometry is invalid.");
    numberPercent(g.x1, "Line x1"); numberPercent(g.y1, "Line y1");
    numberPercent(g.x2, "Line x2"); numberPercent(g.y2, "Line y2");
  } else if (kind === "CIRCLE" || kind === "RECT") {
    const label = kind === "CIRCLE" ? "Circle" : "Rectangle";
    const g = parsed as { x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown };
    if (!g || typeof g !== "object") throw new MapError(`${label} geometry is invalid.`);
    numberPercent(g.x1, `${label} x1`); numberPercent(g.y1, `${label} y1`);
    numberPercent(g.x2, `${label} x2`); numberPercent(g.y2, `${label} y2`);
  } else if (kind === "PATH") {
    const g = parsed as { points?: unknown };
    const points = g?.points;
    if (!Array.isArray(points) || points.length < 2) throw new MapError("Paths need at least two points.");
    for (const point of points) {
      const p = point as { x?: unknown; y?: unknown };
      if (!p || typeof p !== "object") throw new MapError("Path points are invalid.");
      numberPercent(p.x, "Point x"); numberPercent(p.y, "Point y");
    }
  } else {
    throw new MapError("Unknown annotation kind.");
  }
  return JSON.stringify(parsed);
}
function parseStyle(style: unknown): string | null {
  if (style === undefined || style === null || style === "") return null;
  if (typeof style !== "string" || style.length > 10_000) throw new MapError("Style is too large.");
  try { JSON.parse(style); } catch { throw new MapError("Style must be valid JSON."); }
  return style;
}

const mapInclude = {
  layers: { orderBy: { order: "asc" as const } },
  markerGroups: true,
  markers: {
    orderBy: { createdAt: "asc" as const },
    include: { article: { select: { id: true, title: true, template: true, excerpt: true, portraitImage: true } } },
  },
  elements: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.MapInclude;

async function getHandler(req: NextRequest) {
  try {
    const worldId = req.nextUrl.searchParams.get("worldId");
    if (!worldId) throw new MapError("A world ID is required.");
    const maps = await prisma.map.findMany({ where: { worldId }, include: mapInclude, orderBy: { createdAt: "asc" } });
    return NextResponse.json(maps);
  } catch (error) { return failure(error); }
}

/** Assert the map belongs to the world and return it. */
async function worldMap(worldId: string, mapId: unknown) {
  const id = requiredString(mapId, "Map ID");
  const map = await prisma.map.findFirst({ where: { id, worldId } });
  if (!map) throw new MapError("Map not found in this world.", 404);
  return map;
}

async function createMap(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const title = requiredString(body.title, "Map name", 200);
  const description = optionalString(body.description, "Description", 2000);
  const imageUrl = requiredString(body.imageUrl, "Map image", 2048);
  if (imageUrl.startsWith("data:") || !isImageReference(imageUrl)) throw new MapError("Choose a valid map image.");
  const map = await prisma.map.create({
    data: {
      worldId,
      title,
      description,
      imageUrl,
      width: positiveInt(body.width, "Map width", 3840),
      height: positiveInt(body.height, "Map height", 2160),
    },
    include: mapInclude,
  });
  return NextResponse.json(map, { status: 201 });
}

async function createLayer(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const mapId = requiredString(body.mapId, "Map ID");
  await worldMap(worldId, mapId);
  const name = requiredString(body.name, "Layer name", 200);
  const layer = await prisma.mapLayer.create({
    data: { mapId, name, order: await prisma.mapLayer.count({ where: { mapId } }), isVisible: true },
  });
  return NextResponse.json(layer, { status: 201 });
}

async function createMarker(body: Record<string, unknown>) {
  const mapId = requiredString(body.mapId, "Map ID");
  const worldId = (body.worldId as string) || (await prisma.map.findUnique({ where: { id: mapId }, select: { worldId: true } }))?.worldId;
  if (!worldId) throw new MapError("Map not found.", 404);
  const map = await prisma.map.findUnique({ where: { id: mapId }, select: { worldId: true } });
  if (!map || map.worldId !== worldId) throw new MapError("Map not found in this world.", 404);
  const title = requiredString(body.title, "Pin title", 200);
  const description = optionalString(body.description, "Description", 2000);
  const x = numberPercent(body.x, "Pin x");
  const y = numberPercent(body.y, "Pin y");
  const layerId = nullableId(body.layerId);
  const groupId = nullableId(body.groupId);
  if (layerId && !(await prisma.mapLayer.findFirst({ where: { id: layerId, mapId } }))) throw new MapError("Layer not found on this map.");
  if (groupId && !(await prisma.markerGroup.findFirst({ where: { id: groupId, mapId } }))) throw new MapError("Marker group not found on this map.");
  let articleId: string | null = null;
  if (body.articleId !== undefined && body.articleId !== null && body.articleId !== "") {
    articleId = requiredString(body.articleId, "Article ID");
    if (!(await prisma.article.findFirst({ where: { id: articleId, worldId } }))) throw new MapError("Article not found in this world.");
  }
  const marker = await prisma.marker.create({
    data: {
      mapId, layerId, groupId, title, description, x, y, articleId,
      icon: (typeof body.icon === "string" && body.icon.trim()) ? body.icon.trim() : "map-pin",
      color: (typeof body.color === "string" && body.color.trim()) ? body.color.trim() : "#3b82f6",
    },
    include: { article: { select: { id: true, title: true, template: true, excerpt: true } } },
  });
  return NextResponse.json(marker, { status: 201 });
}

async function createElement(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const mapId = requiredString(body.mapId, "Map ID");
  await worldMap(worldId, mapId);
  const kind = requiredString(body.kind, "Annotation kind", 20).toUpperCase();
  const layerId = nullableId(body.layerId);
  if (layerId && !(await prisma.mapLayer.findFirst({ where: { id: layerId, mapId } }))) throw new MapError("Layer not found on this map.");
  const element = await prisma.mapElement.create({
    data: {
      mapId, layerId, kind,
      geometry: parseGeometry(kind, body.geometry),
      style: parseStyle(body.style),
    },
    include: { layer: true },
  });
  return NextResponse.json(element, { status: 201 });
}

async function updateMap(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const id = requiredString(body.id, "Map ID");
  await worldMap(worldId, id);
  const data: Prisma.MapUpdateInput = {};
  if (body.title !== undefined) data.title = requiredString(body.title, "Map name", 200);
  if (body.description !== undefined) data.description = optionalString(body.description, "Description", 2000);
  if (body.imageUrl !== undefined) {
    const imageUrl = requiredString(body.imageUrl, "Map image", 2048);
    if (imageUrl.startsWith("data:") || !isImageReference(imageUrl)) throw new MapError("Choose a valid map image.");
    data.imageUrl = imageUrl;
  }
  const map = await prisma.map.update({ where: { id }, data, include: mapInclude });
  return NextResponse.json(map);
}

async function updateLayer(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const mapId = requiredString(body.mapId, "Map ID");
  const id = requiredString(body.id, "Layer ID");
  await worldMap(worldId, mapId);
  if (!(await prisma.mapLayer.findFirst({ where: { id, mapId } }))) throw new MapError("Layer not found on this map.", 404);
  const data: Prisma.MapLayerUpdateInput = {};
  if (body.name !== undefined) data.name = requiredString(body.name, "Layer name", 200);
  if (body.isVisible !== undefined) {
    if (typeof body.isVisible !== "boolean") throw new MapError("Layer visibility must be a boolean.");
    data.isVisible = body.isVisible;
  }
  const layer = await prisma.mapLayer.update({ where: { id }, data });
  return NextResponse.json(layer);
}

async function reorderLayer(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const mapId = requiredString(body.mapId, "Map ID");
  const id = requiredString(body.id, "Layer ID");
  const direction = requiredString(body.direction, "Direction", 8).toLowerCase();
  if (!["up", "down"].includes(direction)) throw new MapError("Move layers up or down.");
  await worldMap(worldId, mapId);
  const layers = await prisma.mapLayer.findMany({ where: { mapId }, orderBy: { order: "asc" } });
  const index = layers.findIndex((layer) => layer.id === id);
  if (index < 0) throw new MapError("Layer not found on this map.", 404);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= layers.length) return NextResponse.json({ success: true });
  const current = layers[index]; const swap = layers[target];
  await prisma.$transaction([
    prisma.mapLayer.update({ where: { id: current.id }, data: { order: swap.order } }),
    prisma.mapLayer.update({ where: { id: swap.id }, data: { order: current.order } }),
  ]);
  return NextResponse.json({ success: true });
}

async function updateMarker(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const mapId = requiredString(body.mapId, "Map ID");
  const id = requiredString(body.id, "Marker ID");
  await worldMap(worldId, mapId);
  const existing = await prisma.marker.findFirst({ where: { id, mapId } });
  if (!existing) throw new MapError("Pin not found on this map.", 404);
  const data: Prisma.MarkerUpdateInput = {};
  if (body.title !== undefined) data.title = requiredString(body.title, "Pin title", 200);
  if (body.description !== undefined) data.description = optionalString(body.description, "Description", 2000);
  if (body.x !== undefined) data.x = numberPercent(body.x, "Pin x");
  if (body.y !== undefined) data.y = numberPercent(body.y, "Pin y");
  if (body.icon !== undefined) data.icon = (typeof body.icon === "string" && body.icon.trim()) ? body.icon.trim() : "map-pin";
  if (body.color !== undefined) data.color = (typeof body.color === "string" && body.color.trim()) ? body.color.trim() : "#3b82f6";
  if (body.layerId !== undefined) {
    const layerId = nullableId(body.layerId);
    if (layerId && !(await prisma.mapLayer.findFirst({ where: { id: layerId, mapId } }))) throw new MapError("Layer not found on this map.");
    data.layer = layerId ? { connect: { id: layerId } } : { disconnect: true };
  }
  if (body.articleId !== undefined) {
    const articleId = nullableId(body.articleId);
    if (articleId && !(await prisma.article.findFirst({ where: { id: articleId, worldId } }))) throw new MapError("Article not found in this world.");
    data.article = articleId ? { connect: { id: articleId } } : { disconnect: true };
  }
  const marker = await prisma.marker.update({ where: { id }, data, include: { article: { select: { id: true, title: true, template: true, excerpt: true } } } });
  return NextResponse.json(marker);
}

async function updateElement(body: Record<string, unknown>) {
  const worldId = requiredString(body.worldId, "World ID");
  const mapId = requiredString(body.mapId, "Map ID");
  const id = requiredString(body.id, "Annotation ID");
  await worldMap(worldId, mapId);
  const existing = await prisma.mapElement.findFirst({ where: { id, mapId } });
  if (!existing) throw new MapError("Annotation not found on this map.", 404);
  const data: Prisma.MapElementUpdateInput = {};
  if (body.kind !== undefined) data.kind = requiredString(body.kind, "Annotation kind", 20).toUpperCase();
  if (body.geometry !== undefined) data.geometry = parseGeometry(typeof body.kind === "string" ? body.kind.toUpperCase() : existing.kind, body.geometry);
  if (body.style !== undefined) data.style = parseStyle(body.style);
  if (body.layerId !== undefined) {
    const layerId = nullableId(body.layerId);
    if (layerId && !(await prisma.mapLayer.findFirst({ where: { id: layerId, mapId } }))) throw new MapError("Layer not found on this map.");
    data.layer = layerId ? { connect: { id: layerId } } : { disconnect: true };
  }
  const element = await prisma.mapElement.update({ where: { id }, data, include: { layer: true } });
  return NextResponse.json(element);
}

async function postHandler(req: NextRequest) {
  try {
    const body = await readBody(req);
    switch (body.action) {
      case "createMap": return await createMap(body);
      case "createLayer": return await createLayer(body);
      case "createMarker": return await createMarker(body);
      case "createElement": return await createElement(body);
      default: throw new MapError("Choose a supported map action.");
    }
  } catch (error) { return failure(error); }
}

async function patchHandler(req: NextRequest) {
  try {
    const body = await readBody(req);
    switch (body.action) {
      case "updateMap": return await updateMap(body);
      case "updateLayer": return await updateLayer(body);
      case "reorderLayer": return await reorderLayer(body);
      case "updateMarker": return await updateMarker(body);
      case "updateElement": return await updateElement(body);
      default: throw new MapError("Choose a supported map action.");
    }
  } catch (error) { return failure(error); }
}

async function deleteHandler(req: NextRequest) {
  try {
    const body = await readBody(req);
    const worldId = requiredString(body.worldId, "World ID");
    const id = requiredString(body.id, "ID");
    switch (body.action) {
      case "deleteMap": {
        await worldMap(worldId, id);
        await prisma.map.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }
      case "deleteLayer": {
        const mapId = requiredString(body.mapId, "Map ID");
        await worldMap(worldId, mapId);
        await prisma.mapLayer.delete({ where: { id, mapId } });
        return NextResponse.json({ success: true });
      }
      case "deleteMarker": {
        const mapId = requiredString(body.mapId, "Map ID");
        await worldMap(worldId, mapId);
        await prisma.marker.delete({ where: { id, mapId } });
        return NextResponse.json({ success: true });
      }
      case "deleteElement": {
        const mapId = requiredString(body.mapId, "Map ID");
        await worldMap(worldId, mapId);
        await prisma.mapElement.delete({ where: { id, mapId } });
        return NextResponse.json({ success: true });
      }
      default: throw new MapError("Choose a supported map action.");
    }
  } catch (error) { return failure(error); }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
export const PATCH = withAuthor(patchHandler);
export const DELETE = withAuthor(deleteHandler);