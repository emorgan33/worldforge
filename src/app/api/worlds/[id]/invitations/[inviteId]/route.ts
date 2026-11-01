import { NextRequest, NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createInvitation } from "@/lib/player-invitations";

export const DELETE = withAuthor({ target: "world-param" }, async (_request: NextRequest, { params }: { params: Promise<{ id: string; inviteId: string }> }) => {
  const { id, inviteId } = await params;
  const result = await prisma.playerInvitation.updateMany({ where: { id: inviteId, worldId: id, claimedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
  return result.count ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Invitation not found." }, { status: 404 });
});

export const POST = withAuthor({ target: "world-param" }, async (request: NextRequest, { params }: { params: Promise<{ id: string; inviteId: string }> }, { user: actor }) => {
  const { id, inviteId } = await params;
  const prior = await prisma.playerInvitation.findFirst({ where: { id: inviteId, worldId: id, claimedAt: null, cancelledAt: null }, select: { email: true } });
  if (!prior) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  const { invitation, token } = await createInvitation(id, prior.email, actor!.id);
  return NextResponse.json({ invitation, claimUrl: `${(process.env.WORLDFORGE_ORIGIN || new URL(request.url).origin).replace(/\/$/, "")}/invite#token=${token}` });
});
