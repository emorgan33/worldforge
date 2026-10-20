import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const worldId = searchParams.get("worldId");
    const articleId = searchParams.get("articleId");

    const where: any = {};
    if (worldId) where.worldId = worldId;
    if (articleId) where.articleId = articleId;

    const secrets = await prisma.secret.findMany({
      where,
      include: {
        article: {
          select: { id: true, title: true, template: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(secrets);
  } catch (error: any) {
    console.error("Failed to fetch secrets:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { worldId, articleId, title, content } = body;

    if (!worldId || !title || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (articleId && !await prisma.article.findFirst({ where: { id: articleId, worldId }, select: { id: true } })) return NextResponse.json({ error: "Article not found in this world" }, { status: 400 });
    const secret = await prisma.secret.create({
      data: {
        worldId,
        articleId: articleId || null,
        title,
        content,
        isRevealed: false,
      },
    });

    return NextResponse.json(secret, { status: 201 });
  } catch (error: any) {
    console.error("Failed to create secret:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function patchHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, isRevealed, title, content } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing secret id" }, { status: 400 });
    }

    const updated = await prisma.secret.update({
      where: { id },
      data: {
        isRevealed: isRevealed !== undefined ? isRevealed : undefined,
        title: title !== undefined ? title : undefined,
        content: content !== undefined ? content : undefined,
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Failed to update secret:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = withAuthor(getHandler);
export const POST = withAuthor(postHandler);
export const PATCH = withAuthor(patchHandler);
