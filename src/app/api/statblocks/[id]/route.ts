import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateBlockInput } from "@/lib/rpg";

type Context = { params: Promise<{ id: string }> };

async function getHandler(_request: NextRequest, { params }: Context) {
  const { id } = await params;
  const block = await prisma.rpgBlock.findUnique({ where: { id } });
  return block ? NextResponse.json(block) : NextResponse.json({ error: "Statblock not found" }, { status: 404 });
}

async function patchHandler(request: NextRequest, { params }: Context) {
  const { id } = await params;
  let body;
  try {
    body = await request.json();
    if (body && typeof body.stats === "string") body.stats = JSON.parse(body.stats);
  } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const error = validateBlockInput(body, true);
  if (error) return NextResponse.json({ error }, { status: 400 });
  try {
    const existing = await prisma.rpgBlock.findUnique({ where: { id }, select: { id: true, system: true, category: true } });
    if (!existing) return NextResponse.json({ error: "Statblock not found" }, { status: 404 });
    const combinationError = validateBlockInput({ system: body.system ?? existing.system, category: body.category ?? existing.category }, true);
    if (combinationError) return NextResponse.json({ error: combinationError }, { status: 400 });
    const block = await prisma.rpgBlock.update({ where: { id }, data: { name: body.name?.trim(), system: body.system, category: body.category, statsJson: body.stats !== undefined ? JSON.stringify(body.stats) : undefined } });
    return NextResponse.json(block);
  } catch (error) {
    console.error("Failed to update statblock:", error);
    return NextResponse.json({ error: "Unable to update statblock" }, { status: 500 });
  }
}

async function deleteHandler(_request: NextRequest, { params }: Context) {
  const { id } = await params;
  try {
    const result = await prisma.rpgBlock.deleteMany({ where: { id } });
    if (!result.count) return NextResponse.json({ error: "Statblock not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete statblock:", error);
    return NextResponse.json({ error: "Unable to delete statblock" }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "resource-param", kind: "statblocks" }, getHandler);
export const PATCH = withAuthor({ target: "resource-param", kind: "statblocks" }, patchHandler);
export const DELETE = withAuthor({ target: "resource-param", kind: "statblocks" }, deleteHandler);
