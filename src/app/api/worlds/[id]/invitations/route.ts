import { NextRequest, NextResponse } from "next/server";
import { withAuthor, sessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createInvitation, normalizeInviteEmail, validInviteEmail } from "@/lib/player-invitations";

export const GET = withAuthor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const invitations = await prisma.playerInvitation.findMany({ where: { worldId: id, claimedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ invitations });
});

export const POST = withAuthor(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const email = normalizeInviteEmail(body?.email);
  if (!validInviteEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const owner = await sessionUser();
  const world = await prisma.world.findUnique({ where: { id }, select: { slug: true, ownerId: true } });
  if (!world || world.ownerId !== owner?.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (email === owner.email) return NextResponse.json({ error: "The world owner is already able to read this world." }, { status: 400 });
  const { invitation, token } = await createInvitation(id, email, owner.id);
  const claimUrl = `${(process.env.WORLDFORGE_ORIGIN || new URL(request.url).origin).replace(/\/$/, "")}/invite#token=${token}`;
  return NextResponse.json({ invitation, claimUrl }, { status: 201 });
});
