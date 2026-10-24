import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { categoryMovePlan, sortOrdered } from "@/lib/category-tree";
import { validateImageReference } from "@/lib/asset-validation";
import { imageAssetId } from "@/lib/assets";

class OrganizationError extends Error { constructor(message: string, public status = 400) { super(message); } }
function failure(error: unknown) {
  if (error instanceof OrganizationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Category operation failed:", error);
  return NextResponse.json({ error: "Unable to update the article tree. Please try again." }, { status: 500 });
}
async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    if (typeof value.worldId !== "string" || !value.worldId) throw new Error();
    return value;
  } catch { throw new OrganizationError("A valid JSON object with a world ID is required"); }
}
function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new OrganizationError(`${label} is required (up to 200 characters)`);
  return value.trim();
}
function nullableId(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !value) throw new OrganizationError("Invalid parent or reorder target");
  return value;
}

async function getHandler(request: NextRequest) {
  const worldId = request.nextUrl.searchParams.get("worldId");
  if (!worldId) return NextResponse.json({ error: "A world ID is required" }, { status: 400 });
  try { return NextResponse.json(await prisma.category.findMany({ where: { worldId }, orderBy: [{ order: "asc" }, { id: "asc" }] })); }
  catch (error) { return failure(error); }
}

async function postHandler(request: NextRequest) {
  try {
    const body = await readBody(request);
    const worldId = body.worldId as string;
    const name = requiredString(body.name, "Category name");
    const parentId = nullableId(body.parentId ?? null);
    const category = await prisma.$transaction(async tx => {
      if (!await tx.world.findUnique({ where: { id: worldId }, select: { id: true } })) throw new OrganizationError("World not found", 404);
      if (parentId && !await tx.category.findFirst({ where: { id: parentId, worldId }, select: { id: true } })) throw new OrganizationError("Parent category not found in this world");
      const last = await tx.category.findFirst({ where: { worldId, parentId }, orderBy: { order: "desc" } });
      return tx.category.create({ data: { worldId, parentId, name, order: (last?.order ?? -1) + 1 } });
    });
    return NextResponse.json(category, { status: 201 });
  } catch (error) { return failure(error); }
}

async function patchHandler(request: NextRequest) {
  try {
    const body = await readBody(request);
    const worldId = body.worldId as string;
    const id = requiredString(body.id, "Item ID");
    if (!["rename", "moveCategory", "moveArticle", "setIconImage"].includes(String(body.action))) throw new OrganizationError("Choose a supported organization action");
    if (body.action === "setIconImage") {
      const iconImage = body.iconImage === null || body.iconImage === "" ? null : body.iconImage;
      if (iconImage !== null && typeof iconImage !== "string") throw new OrganizationError("Choose a library image or clear the category illustration");
      if (iconImage !== null && !imageAssetId(iconImage)) throw new OrganizationError("Category illustrations must be library images from this world");
      if (iconImage !== null) {
        const error = await validateImageReference(iconImage, worldId);
        if (error) throw new OrganizationError(error);
      }
      await prisma.$transaction(async tx => {
        const category = await tx.category.findFirst({ where: { id, worldId }, select: { id: true } });
        if (!category) throw new OrganizationError("Category not found in this world", 404);
        await tx.category.update({ where: { id }, data: { iconImage } });
      });
      return NextResponse.json({ success: true });
    }
    await prisma.$transaction(async tx => {
      if (body.action === "moveArticle") {
        const article = await tx.article.findFirst({ where: { id, worldId }, select: { id: true } });
        if (!article) throw new OrganizationError("Article not found in this world", 404);
        const categoryId = nullableId(body.parentId);
        if (categoryId && !await tx.category.findFirst({ where: { id: categoryId, worldId }, select: { id: true } })) throw new OrganizationError("Destination category not found in this world");
        const siblings = await tx.article.findMany({ where: { worldId, categoryId, id: { not: id } }, select: { id: true, order: true }, orderBy: [{ order: "asc" }, { id: "asc" }] });
        const beforeId = nullableId(body.beforeId ?? null);
        if (beforeId === id) return;
        const index = beforeId === null ? siblings.length : siblings.findIndex(item => item.id === beforeId);
        if (index < 0) throw new OrganizationError("The reorder target must belong to the destination category");
        siblings.splice(index, 0, { id, order: 0 });
        for (const [order, item] of siblings.entries()) await tx.article.update({ where: { id: item.id }, data: { categoryId, order } });
        return;
      }
      const categories = await tx.category.findMany({ where: { worldId } });
      if (!categories.some(category => category.id === id)) throw new OrganizationError("Category not found in this world", 404);
      if (body.action === "rename") { await tx.category.update({ where: { id }, data: { name: requiredString(body.name, "Category name") } }); return; }
      let updates;
      try { updates = categoryMovePlan(categories, id, nullableId(body.parentId), nullableId(body.beforeId ?? null)); }
      catch (error) { throw new OrganizationError(error instanceof Error ? error.message : "Invalid category move"); }
      for (const update of updates) await tx.category.update({ where: { id: update.id }, data: { parentId: update.parentId, order: update.order } });
    });
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}

async function deleteHandler(request: NextRequest) {
  try {
    const body = await readBody(request);
    const worldId = body.worldId as string;
    const id = requiredString(body.id, "Category ID");
    await prisma.$transaction(async tx => {
      const category = await tx.category.findFirst({ where: { id, worldId } });
      if (!category) throw new OrganizationError("Category not found in this world", 404);
      const siblings = await tx.category.findMany({ where: { worldId, parentId: category.parentId }, orderBy: [{ order: "asc" }, { id: "asc" }] });
      const children = await tx.category.findMany({ where: { worldId, parentId: id }, orderBy: [{ order: "asc" }, { id: "asc" }] });
      const promoted = siblings.flatMap(item => item.id === id ? children : [item]);
      for (const [order, item] of promoted.entries()) await tx.category.update({ where: { id: item.id }, data: { parentId: category.parentId, order } });
      const targetArticles = sortOrdered(await tx.article.findMany({ where: { worldId, categoryId: category.parentId }, select: { id: true, order: true } }));
      const sourceArticles = sortOrdered(await tx.article.findMany({ where: { worldId, categoryId: id }, select: { id: true, order: true } }));
      for (const [order, article] of [...targetArticles, ...sourceArticles].entries()) await tx.article.update({ where: { id: article.id }, data: { categoryId: category.parentId, order } });
      await tx.category.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
export const PATCH = withAuthor(patchHandler);
export const DELETE = withAuthor(deleteHandler);
