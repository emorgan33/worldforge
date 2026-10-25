import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const sessionInclude = {
  linkedEntities: {
    orderBy: { order: "asc" },
  },
} as const;

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await prisma.campaignSession.findUnique({
      where: { id },
      include: sessionInclude,
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error: unknown) {
    console.error("Failed to get session:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { title, description, sessionDate, inWorldDate, currentLocation, status, recap, nextPrep, isNext } = body;

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (sessionDate !== undefined) data.sessionDate = sessionDate ? new Date(sessionDate) : null;
    if (inWorldDate !== undefined) data.inWorldDate = inWorldDate;
    if (currentLocation !== undefined) data.currentLocation = currentLocation;
    if (status !== undefined) data.status = status;
    if (recap !== undefined) data.recap = recap;
    if (nextPrep !== undefined) data.nextPrep = nextPrep;
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.campaignSession.findUnique({ where: { id }, select: { id: true, worldId: true } });
      if (!existing) return null;
      if (isNext === true) {
        // Clear the old selection and set this one in the same transaction.
        await tx.campaignSession.updateMany({
          where: { worldId: existing.worldId, isNext: true }, data: { isNext: false },
        });
      }
      if (isNext !== undefined) data.isNext = isNext;
      return tx.campaignSession.update({ where: { id }, data, include: sessionInclude });
    });
    if (!result) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Failed to update session:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.campaignSession.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await prisma.campaignSession.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Failed to delete session:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "resource-param", kind: "sessions" }, getHandler);
export const PATCH = withAuthor({ target: "resource-param", kind: "sessions" }, patchHandler);
export const DELETE = withAuthor({ target: "resource-param", kind: "sessions" }, deleteHandler);
