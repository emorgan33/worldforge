import { prisma } from "./db";
import { AccessError } from "./access";
import { recordAuditEvent } from "./audit";
import { newToken, tokenHash } from "./passwords";

const PREVIEW_EXPIRY_SECONDS = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Member management
// ---------------------------------------------------------------------------
export async function addMember(worldId: string, userId: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const existing = await tx.worldMember.findUnique({
      where: { worldId_userId: { worldId, userId } }, select: { status: true },
    });
    if (existing?.status === "ACTIVE") return;
    await tx.worldMember.upsert({
      where: { worldId_userId: { worldId, userId } },
      create: { worldId, userId, role: "PLAYER", status: "ACTIVE" },
      update: { status: "ACTIVE", revokedAt: null, revokedById: null },
    });
    await recordAuditEvent({
      worldId, action: "add_member", actorId,
      beforeJson: existing ? JSON.stringify({ status: existing.status }) : null,
      afterJson: JSON.stringify({ status: "ACTIVE" }),
    }, tx);
  });
}

export async function revokeMember(worldId: string, userId: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const member = await tx.worldMember.findUnique({
      where: { worldId_userId: { worldId, userId } }, select: { status: true },
    });
    if (!member || member.status === "REVOKED") throw new AccessError("Member not found.", 404);
    const now = new Date();
    await tx.worldMember.update({
      where: { worldId_userId: { worldId, userId } },
      data: { status: "REVOKED", revokedAt: now, revokedById: actorId },
    });
    // Rejoining does not silently restore prior snapshot grants.
    await tx.audienceGrant.updateMany({
      where: { userId, revokedAt: null, policy: { worldId } },
      data: { revokedAt: now, revokedById: actorId },
    });
    await tx.previewSession.updateMany({
      where: { userId, worldId, revokedAt: null }, data: { revokedAt: now },
    });
    await recordAuditEvent({
      worldId, action: "revoke_member", actorId,
      beforeJson: JSON.stringify({ status: member.status }),
      afterJson: JSON.stringify({ status: "REVOKED" }),
    }, tx);
  });
}

// ---------------------------------------------------------------------------
// Audience policy management
// ---------------------------------------------------------------------------
export async function createPolicy(
  worldId: string,
  resourceKind: string,
  resourceId: string,
  mode: "GM_ONLY" | "PLAYER_SNAPSHOT" | "PUBLIC",
  actorId: string,
  playerIds?: string[]
) {
  return prisma.$transaction(async tx => {
    const existing = await tx.audiencePolicy.findUnique({
      where: { resourceKind_resourceId: { resourceKind, resourceId } }, select: { id: true },
    });
    if (existing) throw new AccessError("Policy already exists for this resource.", 409);
    const policy = await tx.audiencePolicy.create({
      data: {
        worldId, resourceKind, resourceId, mode, createdById: actorId,
        grants: mode === "PLAYER_SNAPSHOT" && playerIds
          ? { create: playerIds.map((uid) => ({ userId: uid, grantedById: actorId })) }
          : undefined,
      },
    });
    await recordAuditEvent({
      worldId, resourceKind, resourceId, action: "create_policy", actorId,
      afterJson: JSON.stringify({ mode, grantCount: playerIds?.length ?? 0 }),
    }, tx);
    return policy;
  });
}

export async function replaceSnapshotGrants(policyId: string, playerIds: string[], actorId: string) {
  await prisma.$transaction(async (tx) => {
    const policy = await tx.audiencePolicy.findUnique({
      where: { id: policyId }, select: { worldId: true, resourceKind: true, resourceId: true, mode: true },
    });
    if (!policy || policy.mode !== "PLAYER_SNAPSHOT") throw new AccessError("Only PLAYER_SNAPSHOT policies can have grants replaced.", 400);
    const now = new Date();
    await tx.audienceGrant.updateMany({
      where: { policyId, revokedAt: null },
      data: { revokedAt: now, revokedById: actorId },
    });
    for (const userId of playerIds) {
      await tx.audienceGrant.upsert({
        where: { policyId_userId: { policyId, userId } },
        create: { policyId, userId, grantedById: actorId },
        update: { revokedAt: null, revokedById: null, grantedById: actorId, grantedAt: new Date() },
      });
    }
    await recordAuditEvent({
      worldId: policy.worldId, resourceKind: policy.resourceKind, resourceId: policy.resourceId,
      action: "retroactive_grant", actorId, afterJson: JSON.stringify({ grantCount: playerIds.length }),
    }, tx);
  });
}

export async function revokePolicy(worldId: string, resourceKind: string, resourceId: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const policy = await tx.audiencePolicy.findUnique({
      where: { resourceKind_resourceId: { resourceKind, resourceId } }, select: { id: true, mode: true },
    });
    if (!policy) throw new AccessError("Policy not found.", 404);
    await tx.audiencePolicy.delete({ where: { id: policy.id } });
    await recordAuditEvent({
      worldId, resourceKind, resourceId, action: "revoke_policy", actorId,
      beforeJson: JSON.stringify({ mode: policy.mode }),
    }, tx);
  });
}

// ---------------------------------------------------------------------------
// Preview sessions
// ---------------------------------------------------------------------------
export async function issuePreviewSession(worldId: string, userId: string, actorId: string) {
  const token = newToken();
  const hash = tokenHash(token);
  await prisma.$transaction(async tx => {
    const member = await tx.worldMember.findUnique({
      where: { worldId_userId: { worldId, userId } }, select: { status: true },
    });
    if (!member || member.status !== "ACTIVE") throw new AccessError("Cannot preview for a non-active member.", 400);
    await tx.previewSession.create({
      data: { tokenHash: hash, userId, worldId, issuedById: actorId, memberAtGrant: true, expiresAt: new Date(Date.now() + PREVIEW_EXPIRY_SECONDS * 1000) },
    });
    await recordAuditEvent({ worldId, action: "issue_preview", actorId, afterJson: JSON.stringify({ userId }) }, tx);
  });
  return { token, expiresIn: PREVIEW_EXPIRY_SECONDS };
}

export async function revokePreviewSession(tokenHash: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const session = await tx.previewSession.findUnique({ where: { tokenHash }, select: { worldId: true, userId: true, revokedAt: true } });
    if (!session || session.revokedAt) throw new AccessError("Preview session not found.", 404);
    await tx.previewSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
    await recordAuditEvent({ worldId: session.worldId, action: "revoke_preview", actorId, afterJson: JSON.stringify({ userId: session.userId }) }, tx);
  });
}

// ---------------------------------------------------------------------------
// Retroactive grant
// ---------------------------------------------------------------------------
export async function retroactiveGrant(worldId: string, resourceKind: string, resourceId: string, userIds: string[], actorId: string) {
  await prisma.$transaction(async (tx) => {
    const policy = await tx.audiencePolicy.findUnique({
      where: { resourceKind_resourceId: { resourceKind, resourceId } }, select: { id: true, mode: true },
    });
    if (!policy || policy.mode !== "PLAYER_SNAPSHOT") throw new AccessError("Resource must have a PLAYER_SNAPSHOT policy.", 400);
    for (const userId of userIds) {
      await tx.audienceGrant.upsert({
        where: { policyId_userId: { policyId: policy.id, userId } },
        create: { policyId: policy.id, userId, grantedById: actorId },
        update: { revokedAt: null, revokedById: null },
      });
    }
    await recordAuditEvent({ worldId, resourceKind, resourceId, action: "retroactive_grant", actorId, afterJson: JSON.stringify({ addedUserIds: userIds }) }, tx);
  });
}
