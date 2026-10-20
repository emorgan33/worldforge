import type { Prisma } from "@prisma/client";
import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");

    const where: Prisma.MapWhereInput = {};
    if (worldId) where.worldId = worldId;

    const maps = await prisma.map.findMany({
      where,
      include: {
        layers: {
          orderBy: { order: "asc" },
        },
        markerGroups: true,
        markers: {
          include: {
            article: {
              select: { id: true, title: true, template: true, excerpt: true, portraitImage: true },
            },
          },
        },
      },
    });

    return NextResponse.json(maps);
  } catch (error: unknown) {
    console.error("Failed to fetch maps:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { mapId, layerId, groupId, title, description, x, y, articleId, icon, color } = body;

    if (!mapId || !title || x === undefined || y === undefined) {
      return NextResponse.json({ error: "Missing required marker fields" }, { status: 400 });
    }

    const map = await prisma.map.findUnique({ where: { id: mapId }, select: { worldId: true } });
    if (!map || (articleId && !await prisma.article.findFirst({ where: { id: articleId, worldId: map.worldId } })) || (layerId && !await prisma.mapLayer.findFirst({ where: { id: layerId, mapId } })) || (groupId && !await prisma.markerGroup.findFirst({ where: { id: groupId, mapId } }))) return NextResponse.json({ error: "Marker references must belong to this map's world" }, { status: 400 });
    const marker = await prisma.marker.create({
      data: {
        mapId,
        layerId: layerId || null,
        groupId: groupId || null,
        title,
        description: description || null,
        x,
        y,
        articleId: articleId || null,
        icon: icon || "map-pin",
        color: color || "#3b82f6",
      },
      include: {
        article: {
          select: { id: true, title: true, template: true, excerpt: true },
        },
      },
    });

    return NextResponse.json(marker, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to create marker:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
