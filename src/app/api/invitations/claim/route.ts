import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionUser, sameOrigin, issueSession, AccessError } from "@/lib/auth";
import { hashPassword, tokenHash, validPassword } from "@/lib/passwords";
import { validInviteToken } from "@/lib/player-invitations";

async function findInvitation(token: string) {
  if (!validInviteToken(token)) return null;
  return prisma.playerInvitation.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { id: true, email: true, worldId: true, expiresAt: true, claimedAt: true, cancelledAt: true, world: { select: { title: true, slug: true, deletedAt: true } } },
  });
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await request.json().catch(() => null);
    const invitation = await findInvitation(body?.token);
    if (!invitation || invitation.claimedAt || invitation.cancelledAt || invitation.expiresAt <= new Date() || invitation.world.deletedAt) throw new AccessError("This invitation is invalid or expired.", 404);
    const signedIn = await sessionUser();
    const existing = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (existing && signedIn?.id !== existing.id) throw new AccessError("Sign in with the invited email address to claim this world.", 403);
    if (!existing && signedIn) throw new AccessError("Sign out before creating an account for the invited email address.", 403);
    if (!existing && (typeof body?.name !== "string" || !body.name.trim() || body.name.length > 120 || !validPassword(body.password))) throw new AccessError("Enter a name and a password of 12–128 characters.", 400);
    const passwordHash = !existing ? await hashPassword(body.password) : null;
    const userId = await prisma.$transaction(async tx => {
      const claimed = await tx.playerInvitation.updateMany({ where: { id: invitation.id, claimedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { claimedAt: new Date() } });
      if (!claimed.count) throw new AccessError("This invitation has already been used.", 409);
      const user = existing ?? await tx.user.create({ data: { email: invitation.email, name: body.name.trim(), role: "PLAYER", passwordHash }, select: { id: true } });
      await tx.worldMember.upsert({ where: { worldId_userId: { worldId: invitation.worldId, userId: user.id } }, create: { worldId: invitation.worldId, userId: user.id, role: "PLAYER", status: "ACTIVE" }, update: { status: "ACTIVE", revokedAt: null, revokedById: null } });
      return user.id;
    });
    if (!existing) await issueSession(userId, request);
    return NextResponse.json({ success: true, worldSlug: invitation.world.slug }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccessError ? error.message : "Unable to claim this invitation." }, { status: error instanceof AccessError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
