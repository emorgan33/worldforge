import type { Prisma } from "@prisma/client";
import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");

    const where: Prisma.VariableCollectionWhereInput = {};
    if (worldId) where.worldId = worldId;

    const collections = await prisma.variableCollection.findMany({
      where,
      include: {
        variables: {
          orderBy: { key: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(collections);
  } catch (error: unknown) {
    console.error("Failed to list variables:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { collectionId, key, title, type = "TERM_SIMPLE", value, description } = body;

    if (typeof collectionId !== "string" || !collectionId || typeof key !== "string" || !key || typeof value !== "string" ||
      (title !== undefined && title !== null && typeof title !== "string") ||
      (description !== undefined && description !== null && typeof description !== "string") ||
      !["TERM_SIMPLE", "TERM_ADVANCED", "RENDERED_FRAGMENT", "LINK", "NUMBER"].includes(type)) {
      return NextResponse.json({ error: "Provide a collection ID, key, supported type and string value; title and description must be text or null." }, { status: 400 });
    }

    const variable = await prisma.variable.create({
      data: {
        collectionId,
        key: key.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        title,
        type,
        value,
        description,
      },
    });

    return NextResponse.json(variable, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to create variable:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

async function patchHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, value, title, description } = body;

    if (typeof id !== "string" || !id || typeof value !== "string" ||
      (title !== undefined && title !== null && typeof title !== "string") ||
      (description !== undefined && description !== null && typeof description !== "string")) {
      return NextResponse.json({ error: "Provide a variable ID and string value; title and description must be text or null." }, { status: 400 });
    }

    const updated = await prisma.variable.update({
      where: { id },
      data: {
        value,
        title: title !== undefined ? title : undefined,
        description: description !== undefined ? description : undefined,
      },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Failed to update variable:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process request." }, { status: 500 });
  }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
export const POST = withAuthor({ target: "resource-body", kind: "collection", field: "collectionId" }, postHandler);
export const PATCH = withAuthor({ target: "resource-body", kind: "variable", field: "id" }, patchHandler);
