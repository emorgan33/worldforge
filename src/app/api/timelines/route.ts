import type { Prisma } from "@prisma/client";
import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");

    const where: Prisma.TimelineWhereInput = {};
    if (worldId) where.worldId = worldId;

    const timelines = await prisma.timeline.findMany({
      where,
      include: {
        eras: {
          orderBy: { startYear: "asc" },
        },
        events: {
          include: {
            article: {
              select: { id: true, title: true, template: true },
            },
            era: true,
          },
          orderBy: { numericDate: "asc" },
        },
      },
    });

    return NextResponse.json(timelines);
  } catch (error: unknown) {
    console.error("Failed to fetch timelines:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
