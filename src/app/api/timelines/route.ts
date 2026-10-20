import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");

    const where: any = {};
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
  } catch (error: any) {
    console.error("Failed to fetch timelines:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
