import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const GET = withAuthor({ target: "world-param" }, async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: worldId } = await params;
  const sessions = await prisma.campaignSession.findMany({
    where: { worldId },
    include: {
      linkedEntities: {
        orderBy: { order: "asc" },
      },
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(sessions);
});

export const POST = withAuthor({ target: "world-param" }, async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: worldId } = await params;
  const body = await request.json();
  const { title, description, sessionDate, inWorldDate, currentLocation, status } = body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  // Auto-increment order
  const lastSession = await prisma.campaignSession.findFirst({
    where: { worldId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const session = await prisma.campaignSession.create({
    data: {
      worldId,
      title: title.trim(),
      description: description || null,
      sessionDate: sessionDate ? new Date(sessionDate) : null,
      inWorldDate: inWorldDate || null,
      currentLocation: currentLocation || null,
      status: status || "PLANNED",
      order: (lastSession?.order ?? -1) + 1,
    },
    include: {
      linkedEntities: {
        orderBy: { order: "asc" },
      },
    },
  });

  return NextResponse.json(session, { status: 201 });
});