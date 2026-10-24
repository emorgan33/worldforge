import { NextResponse } from "next/server";
import { withAuthor, sessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateAppearance } from "@/lib/world-appearance";
import type { WorldAppearance } from "@/lib/world-appearance";
import { assertImageReference, validateImageReference, ImageReferenceError } from "@/lib/asset-validation";
import { validatePlacementAlt, normalizePlacementAlt } from "@/lib/image-placement";
import { RPG_SYSTEMS } from "@/lib/rpg";
import { createWorld, normalizeWorldCreation } from "@/lib/world-creation";

const WORLD_PROJECTION = {
  id: true, slug: true, title: true, description: true, genre: true, system: true,
  isPublic: true, coverImage: true, bannerImage: true, appearance: true, createdAt: true, updatedAt: true,
  coverImageAlt: true, bannerImageAlt: true,
  categories: { select: { id: true, worldId: true, name: true, parentId: true, order: true, icon: true, iconImage: true, createdAt: true, updatedAt: true }, orderBy: { order: "asc" as const } },
  _count: { select: { articles: true, maps: true, timelines: true, secrets: true, variableCollections: true } },
} as const;

async function getHandler() {
  try {
    const worlds = await prisma.world.findMany({ where: { ownerId: (await sessionUser())!.id, deletedAt: null }, select: WORLD_PROJECTION, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return NextResponse.json(worlds);
  } catch (error) {
    console.error("Failed to fetch worlds:", error);
    return NextResponse.json({ error: "Failed to fetch worlds" }, { status: 500 });
  }
}

async function postHandler(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 64 * 1024) return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  let raw: string;
  try {
    if (!request.body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) {
        await reader.cancel();
        return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
      }
      chunks.push(value);
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const payload = normalizeWorldCreation(body);
  if (!payload) return NextResponse.json({ error: "Provide a title, supported system and valid request ID; description must be up to 10,000 characters." }, { status: 400 });
  try {
    const ownerId = (await sessionUser())!.id;
    const result = await createWorld(ownerId, payload);
    if (result.conflict) return NextResponse.json({ error: "This request ID was already used for different world details." }, { status: 409 });
    const world = await prisma.world.findUnique({ where: { id: result.world.id }, select: WORLD_PROJECTION });
    if (!world) throw new Error("Created world could not be read");
    return NextResponse.json(world, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error("Failed to create world:", error);
    return NextResponse.json({ error: "Failed to create world" }, { status: 500 });
  }
}

async function patchHandler(request: Request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.id !== "string" || !body.id || typeof body.title !== "string" || !body.title.trim() || body.title.length > 200 || typeof body.description !== "string" || body.description.length > 10000) {
    return NextResponse.json({ error: "A world ID, title and description are required" }, { status: 400 });
  }
  if (body.isPublic !== undefined && typeof body.isPublic !== "boolean") return NextResponse.json({ error: "Invalid world visibility" }, { status: 400 });
  if (body.system !== undefined && !RPG_SYSTEMS.some(profile => profile.id === body.system)) return NextResponse.json({ error: "Choose a supported campaign system" }, { status: 400 });
  for (const key of ["coverImage", "bannerImage"]) {
    const error = await validateImageReference(body[key], body.id);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }
  const altError = validatePlacementAlt(body.coverImageAlt) || validatePlacementAlt(body.bannerImageAlt);
  if (altError) return NextResponse.json({ error: altError }, { status: 400 });
  let appearance: WorldAppearance | undefined;
  if (body.appearance !== undefined) {
    try { appearance = validateAppearance(body.appearance); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    const error = await validateImageReference(appearance.backgroundImage, body.id);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }
  try {
    const existing = await prisma.world.findUnique({ where: { id: body.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "World not found" }, { status: 404 });
    await prisma.$transaction(async tx => {
      await assertImageReference(body.coverImage, body.id, tx);
      await assertImageReference(body.bannerImage, body.id, tx);
      if (appearance) await assertImageReference(appearance.backgroundImage, body.id, tx);
      await tx.world.update({
        where: { id: body.id },
        data: { ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}), ...(body.system !== undefined ? { system: body.system } : {}), ...(appearance ? { appearance: JSON.stringify(appearance) } : {}), title: body.title.trim(), description: body.description.trim(), coverImage: body.coverImage.trim() || null, bannerImage: body.bannerImage.trim() || null, ...(body.coverImageAlt !== undefined ? { coverImageAlt: normalizePlacementAlt(body.coverImageAlt) } : {}), ...(body.bannerImageAlt !== undefined ? { bannerImageAlt: normalizePlacementAlt(body.bannerImageAlt) } : {}) },
      });
    });
    const world = await prisma.world.findUnique({ where: { id: body.id }, select: WORLD_PROJECTION });
    return NextResponse.json(world);
  } catch (error) {
    if (error instanceof ImageReferenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Failed to update world:", error);
    return NextResponse.json({ error: "Failed to update world" }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
export const PATCH = withAuthor(patchHandler);
