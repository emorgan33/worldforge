import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateBlockInput } from "@/lib/rpg";

async function getHandler(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const worldId = params.get("worldId");
  const system = params.get("system");
  const category = params.get("category");
  const query = params.get("q");
  try {
    const blocks = await prisma.rpgBlock.findMany({
      where: {
        ...(worldId ? { worldId } : {}),
        ...(system && system !== "ALL" ? { system } : {}),
        ...(category && category !== "ALL" ? { category } : {}),
        ...(query ? { name: { contains: query } } : {}),
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(blocks);
  } catch (error) {
    console.error("Failed to fetch statblocks:", error);
    return NextResponse.json({ error: "Unable to load statblocks" }, { status: 500 });
  }
}

async function postHandler(request: NextRequest) {
  let body;
  try {
    body = await request.json();
    if (body && typeof body.stats === "string") body.stats = JSON.parse(body.stats);
  } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const error = validateBlockInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  try {
    const world = await prisma.world.findUnique({ where: { id: body.worldId }, select: { id: true } });
    if (!world) return NextResponse.json({ error: "World not found" }, { status: 404 });
    const block = await prisma.rpgBlock.create({ data: { worldId: body.worldId, system: body.system, category: body.category, name: body.name.trim(), statsJson: JSON.stringify(body.stats) } });
    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    console.error("Failed to create statblock:", error);
    return NextResponse.json({ error: "Unable to create statblock" }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
export const POST = withAuthor({ target: "world-body", field: "worldId" }, postHandler);
