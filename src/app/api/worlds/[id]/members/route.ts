import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addMember } from "@/lib/membership";

export const POST = withAuthor({ target: "world-param" }, async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, { user }) => {
  const { id: worldId } = await params;
  const body = await request.json();
  const { userId } = body;
  if (!userId || typeof userId !== "string") return NextResponse.json({ error: "userId is required" }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  await addMember(worldId, userId, user.id);
  return NextResponse.json({ success: true });
});

export const GET = withAuthor({ target: "world-param" }, async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: worldId } = await params;
  const members = await prisma.worldMember.findMany({
    where: { worldId, status: "ACTIVE" },
    select: { id: true, userId: true, role: true, status: true, joinedAt: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: "desc" },
  });
  return NextResponse.json({ members });
});
