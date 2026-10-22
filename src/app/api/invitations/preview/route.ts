import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionUser, sameOrigin, AccessError } from "@/lib/auth";
import { tokenHash } from "@/lib/passwords";
import { validInviteToken } from "@/lib/player-invitations";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await request.json().catch(() => null);
    if (!validInviteToken(body?.token)) throw new AccessError("Invalid invitation.", 404);
    const invitation = await prisma.playerInvitation.findUnique({ where: { tokenHash: tokenHash(body.token) }, select: { email: true, expiresAt: true, claimedAt: true, cancelledAt: true, world: { select: { title: true, deletedAt: true } } } });
    if (!invitation || invitation.claimedAt || invitation.cancelledAt || invitation.expiresAt <= new Date() || invitation.world.deletedAt) throw new AccessError("This invitation is invalid or expired.", 404);
    const accountExists = !!await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    const signedIn = await sessionUser();
    return NextResponse.json({ invitation: { email: invitation.email, worldTitle: invitation.world.title, expiresAt: invitation.expiresAt }, accountExists, signedInEmail: signedIn?.email ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccessError ? error.message : "Unable to open invitation." }, { status: error instanceof AccessError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
