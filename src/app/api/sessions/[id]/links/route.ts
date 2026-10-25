import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const GET = withAuthor({ target: "resource-param", kind: "sessions" }, async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: sessionId } = await params;
  const links = await prisma.sessionEntityLink.findMany({
    where: { sessionId },
    orderBy: { order: "asc" },
  });
  return NextResponse.json(links);
});

export const POST = withAuthor({ target: "resource-param", kind: "sessions" }, async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: sessionId } = await params;

  const session = await prisma.campaignSession.findUnique({
    where: { id: sessionId },
    select: { worldId: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await request.json();
  const { kind, entityId, label } = body;

  if (!kind || !entityId) {
    return NextResponse.json({ error: "kind and entityId are required." }, { status: 400 });
  }

  // Validate that the entity exists in the same world
  if (kind === "article") {
    const article = await prisma.article.findUnique({
      where: { id: entityId },
      select: { worldId: true },
    });
    if (!article || article.worldId !== session.worldId) {
      return NextResponse.json({ error: "Entity not found in this world." }, { status: 400 });
    }
  } else if (kind === "statblock") {
    const block = await prisma.rpgBlock.findUnique({
      where: { id: entityId },
      select: { worldId: true },
    });
    if (!block || block.worldId !== session.worldId) {
      return NextResponse.json({ error: "Entity not found in this world." }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Unsupported entity kind. Use 'article' or 'statblock'." }, { status: 400 });
  }

  // Auto-increment order within the session
  const lastLink = await prisma.sessionEntityLink.findFirst({
    where: { sessionId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const link = await prisma.sessionEntityLink.create({
    data: {
      sessionId,
      worldId: session.worldId,
      kind,
      entityId,
      label: label || null,
      order: (lastLink?.order ?? -1) + 1,
    },
  });

  return NextResponse.json(link, { status: 201 });
});

export const DELETE = withAuthor({ target: "resource-param", kind: "sessions" }, async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: sessionId } = await params;
  const url = new URL(request.url);
  const linkId = url.searchParams.get("linkId");

  if (!linkId) {
    return NextResponse.json({ error: "linkId query parameter is required." }, { status: 400 });
  }

  const link = await prisma.sessionEntityLink.findUnique({
    where: { id: linkId },
    select: { sessionId: true },
  });

  if (!link || link.sessionId !== sessionId) {
    return NextResponse.json({ error: "Link not found." }, { status: 404 });
  }

  await prisma.sessionEntityLink.delete({ where: { id: linkId } });
  return NextResponse.json({ success: true });
});