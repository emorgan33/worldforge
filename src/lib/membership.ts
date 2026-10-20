import { prisma } from "./db";
import { AccessError } from "./access";
import { recordAuditEvent } from "./audit";
import { newToken, tokenHash } from "./passwords";

const PREVIEW_EXPIRY_SECONDS = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Member management
// ---------------------------------------------------------------------------
export async function addMember(worldId: string, userId: string, actorId: string) {
  const existing = await prisma.worldMember.findUnique({
    where: { worldId_userId: { worldId, userId } },
    select: { status: true },
  });
  if (existing?.status === "ACTIVE") return;

  await prisma.worldMember.upsert({
    where: { worldId_userId: { worldId, userId } },
    create: { worldId, userId, role: "PLAYER", status: "ACTIVE" },
    update: { status: "ACTIVE", revokedAt: null, revokedById: null },
  });

  await recordAuditEvent({
    worldId,
    action: "add_member",
    actorId,
    beforeJson: existing ? JSON.stringify({ status: existing.status }) : null,
    afterJson: JSON.stringify({ status: "ACTIVE" }),
  });
}

export async function revokeMember(worldId: string, userId: string, actorId: string) {
  const member = await prisma.worldMember.findUnique({
    where: { worldId_userId: { worldId, userId } },
    select: { status: true },
  });
  if (!member || member.status === "REVOKED") throw new AccessError("Member not found.", 404);

  await prisma.worldMember.update({
    where: { worldId_userId: { worldId, userId } },
    data: { status: "REVOKED", revokedAt: new Date(), revokedById: actorId },
  });

  // Revoke any preview sessions for this member
  await prisma.previewSession.updateMany({
    where: { userId, worldId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await recordAuditEvent({
    worldId,
    action: "revoke_member",
    actorId,
    beforeJson: JSON.stringify({ status: member.status }),
    afterJson: JSON.stringify({ status: "REVOKED" }),
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
  const existing = await prisma.audiencePolicy.findUnique({
    where: { resourceKind_resourceId: { resourceKind, resourceId } },
    select: { id: true },
  });
  if (existing) throw new AccessError("Policy already exists for this resource.", 409);

  const policy = await prisma.audiencePolicy.create({
    data: {
      worldId,
      resourceKind,
      resourceId,
      mode,
      createdById: actorId,
      grants: mode === "PLAYER_SNAPSHOT" && playerIds
        ? { create: playerIds.map((uid) => ({ userId: uid, grantedById: actorId })) }
        : undefined,
    },
  });

  await recordAuditEvent({
    worldId,
    resourceKind,
    resourceId,
    action: "create_policy",
    actorId,
    afterJson: JSON.stringify({ mode, grantCount: playerIds?.length ?? 0 }),
  });

  return policy;
}

export async function replaceSnapshotGrants(policyId: string, playerIds: string[], actorId: string) {
  const policy = await prisma.audiencePolicy.findUnique({
    where: { id: policyId },
    select: { worldId: true, resourceKind: true, resourceId: true, mode: true },
  });
  if (!policy || policy.mode !== "PLAYER_SNAPSHOT") {
    throw new AccessError("Only PLAYER_SNAPSHOT policies can have grants replaced.", 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.audienceGrant.updateMany({
      where: { policyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actorId },
    });
    for (const userId of playerIds) {
      await tx.audienceGrant.create({ data: { policyId, userId, grantedById: actorId } });
    }
  });

  await recordAuditEvent({
    worldId: policy.worldId,
    resourceKind: policy.resourceKind,
    resourceId: policy.resourceId,
    action: "retroactive_grant",
    actorId,
    afterJson: JSON.stringify({ grantCount: playerIds.length }),
  });
}

export async function revokePolicy(worldId: string, resourceKind: string, resourceId: string, actorId: string) {
  const policy = await prisma.audiencePolicy.findUnique({
    where: { resourceKind_resourceId: { resourceKind, resourceId } },
    select: { id: true, mode: true },
  });
  if (!policy) throw new AccessError("Policy not found.", 404);

  await prisma.audiencePolicy.delete({ where: { id: policy.id } });

  await recordAuditEvent({
    worldId, resourceKind, resourceId,
    action: "revoke_policy", actorId,
    beforeJson: JSON.stringify({ mode: policy.mode }),
  });
}

// ---------------------------------------------------------------------------
// Preview sessions
// ---------------------------------------------------------------------------
export async function issuePreviewSession(worldId: string, userId: string, actorId: string) {
  const member = await prisma.worldMember.findUnique({
    where: { worldId_userId: { worldId, userId } },
    select: { status: true },
  });
  if (!member || member.status !== "ACTIVE") {
    throw new AccessError("Cannot preview for a non-active member.", 400);
  }

  const token = newToken();
  const hash = tokenHash(token);
  await prisma.previewSession.create({
    data: { tokenHash: hash, userId, worldId, issuedById: actorId, memberAtGrant: true, expiresAt: new Date(Date.now() + PREVIEW_EXPIRY_SECONDS * 1000) },
  });

  await recordAuditEvent({ worldId, action: "issue_preview", actorId, afterJson: JSON.stringify({ userId }) });
  return { token, expiresIn: PREVIEW_EXPIRY_SECONDS };
}

export async function revokePreviewSession(tokenHash: string, actorId: string) {
  const session = await prisma.previewSession.findUnique({ where: { tokenHash }, select: { worldId: true, userId: true } });
  if (!session) throw new AccessError("Preview session not found.", 404);
  await prisma.previewSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
  await recordAuditEvent({ worldId: session.worldId, action: "revoke_preview", actorId, afterJson: JSON.stringify({ userId: session.userId }) });
}

// ---------------------------------------------------------------------------
// Retroactive grant
// ---------------------------------------------------------------------------
export async function retroactiveGrant(worldId: string, resourceKind: string, resourceId: string, userIds: string[], actorId: string) {
  const policy = await prisma.audiencePolicy.findUnique({
    where: { resourceKind_resourceId: { resourceKind, resourceId } },
    select: { id: true, mode: true },
  });
  if (!policy || policy.mode !== "PLAYER_SNAPSHOT") {
    throw new AccessError("Resource must have a PLAYER_SNAPSHOT policy.", 400);
  }

  await prisma.$transaction(async (tx) => {
    for (const userId of userIds) {
      await tx.audienceGrant.upsert({
        where: { policyId_userId: { policyId: policy.id, userId } },
        create: { policyId: policy.id, userId, grantedById: actorId },
        update: { revokedAt: null, revokedById: null },
      });
    }
  });

  await recordAuditEvent({ worldId, resourceKind, resourceId, action: "retroactive_grant", actorId, afterJson: JSON.stringify({ addedUserIds: userIds }) });
}
