import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sameOrigin, createSessionRecord, setSessionCookie, AccessError } from "@/lib/auth";
import { hashPassword, newToken, tokenHash, validPassword } from "@/lib/passwords";
import { validInviteToken } from "@/lib/player-invitations";
import { SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth-constants";
import { AccountLifecycleConflictError, findActiveSessionActor, withAccountLifecycleLock } from "@/lib/account-lifecycle";

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
    const existingSessionToken = request.cookies.get(SESSION_COOKIE)?.value;
    const passwordHash = validPassword(body?.password) ? await hashPassword(body.password) : null;
    const sessionToken = newToken();
    const sessionExpiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    const claim = await withAccountLifecycleLock(prisma, async (tx) => {
      const signedIn = existingSessionToken ? await findActiveSessionActor(tx, tokenHash(existingSessionToken)) : null;
      const current = await tx.playerInvitation.findUnique({ where: { id: invitation.id }, select: { id: true, email: true, worldId: true, expiresAt: true, claimedAt: true, cancelledAt: true, world: { select: { deletedAt: true, slug: true } } } });
      if (!current || current.claimedAt || current.cancelledAt || current.expiresAt <= new Date() || current.world.deletedAt) throw new AccessError("This invitation is invalid or expired.", 404);
      const existing = await tx.user.findUnique({ where: { email: current.email }, select: { id: true, disabledAt: true } });
      if (existing?.disabledAt) throw new AccessError("This account is disabled and cannot claim invitations.", 403);
      if (existing && existingSessionToken && !signedIn) throw new AccessError("Your sign-in session is no longer valid. Sign in again to claim this invitation.", 401);
      if (existing && signedIn?.id !== existing.id) throw new AccessError("Sign in with the invited email address to claim this world.", 403);
      if (!existing && signedIn) throw new AccessError("Sign out before creating an account for the invited email address.", 403);
      if (!existing && (typeof body?.name !== "string" || !body.name.trim() || body.name.length > 120 || !passwordHash)) throw new AccessError("Enter a name and a password of 12–128 characters.", 400);
      const claimed = await tx.playerInvitation.updateMany({ where: { id: current.id, claimedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { claimedAt: new Date() } });
      if (!claimed.count) throw new AccessError("This invitation has already been used.", 409);
      const user = existing ?? await tx.user.create({ data: { email: current.email, name: body.name.trim(), role: "PLAYER", passwordHash }, select: { id: true } });
      await tx.worldMember.upsert({ where: { worldId_userId: { worldId: current.worldId, userId: user.id } }, create: { worldId: current.worldId, userId: user.id, role: "PLAYER", status: "ACTIVE" }, update: { status: "ACTIVE", revokedAt: null, revokedById: null } });
      if (!existing) await createSessionRecord(tx, user.id, sessionToken, sessionExpiresAt);
      return { userId: user.id, worldSlug: current.world.slug, newAccount: !existing };
    });
    if (claim.newAccount) await setSessionCookie(sessionToken, request);
    return NextResponse.json({ success: true, worldSlug: claim.worldSlug }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountLifecycleConflictError) return NextResponse.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
    return NextResponse.json({ error: error instanceof AccessError ? error.message : "Unable to claim this invitation." }, { status: error instanceof AccessError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
