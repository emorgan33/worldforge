import { NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeWorldCreation } from "@/lib/world-creation";
import { duplicateWorldSettings } from "@/lib/world-management";

const WORLD_SUMMARY = {
  id: true, slug: true, title: true, description: true, genre: true, system: true,
  isPublic: true, coverImage: true, bannerImage: true, appearance: true,
  createdAt: true, updatedAt: true,
  categories: { select: { id: true, worldId: true, name: true, parentId: true, order: true, icon: true, createdAt: true, updatedAt: true }, orderBy: { order: "asc" as const } },
  _count: { select: { articles: true, maps: true, timelines: true, secrets: true, variableCollections: true } },
} as const;

export const POST = withAuthor({ target: "world-param" }, async (request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { requestId?: unknown }).requestId !== "string") {
    return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
  }
  const requestId = (body as { requestId: string }).requestId;
  // Reuse the creation input validator for its UUID rules without accepting any
  // caller-controlled duplicate content.
  if (!normalizeWorldCreation({ title: "Copy", system: "DND_5E", requestId })) return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
  try {
    const { id: sourceId } = await params;
    const ownerId = user.id;
    const result = await duplicateWorldSettings(sourceId, ownerId, requestId);
    if (result.missing) return NextResponse.json({ error: "World not found." }, { status: 404 });
    if (result.conflict) return NextResponse.json({ error: "This requestId was already used for different world details." }, { status: 409 });
    const world = await prisma.world.findFirst({ where: { id: result.world.id, ownerId, deletedAt: null }, select: WORLD_SUMMARY });
    if (!world) return NextResponse.json({ error: "Duplicated world could not be read." }, { status: 500 });
    return NextResponse.json(world, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error("Failed to duplicate world settings:", error);
    return NextResponse.json({ error: "Failed to duplicate world settings." }, { status: 500 });
  }
});
