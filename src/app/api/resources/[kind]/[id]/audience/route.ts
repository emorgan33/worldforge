import { withAuthor, sessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveResourceWorld } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

const KINDS = new Set(["articles", "statblocks", "secrets", "maps", "assets"]);

async function contextFor(kind: string, resourceId: string) {
  if (!KINDS.has(kind)) return null;
  const worldId = await resolveResourceWorld(kind, resourceId);
  return worldId ? { worldId } : null;
}

export const GET = withAuthor(async (_request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await params;
  const context = await contextFor(kind, id);
  if (!context) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [policy, members] = await Promise.all([
    prisma.audiencePolicy.findUnique({ where: { resourceKind_resourceId: { resourceKind: kind, resourceId: id } }, select: { mode: true, grants: { where: { revokedAt: null }, select: { userId: true } } } }),
    prisma.worldMember.findMany({ where: { worldId: context.worldId, status: "ACTIVE" }, select: { userId: true, user: { select: { name: true, email: true } } }, orderBy: { joinedAt: "asc" } }),
  ]);
  const activeIds = new Set(members.map(member => member.userId));
  const userIds = policy?.mode === "PUBLIC" ? members.map(member => member.userId) : (policy?.grants ?? []).map(grant => grant.userId).filter(id => activeIds.has(id));
  return NextResponse.json({ mode: policy?.mode ?? "GM_ONLY", userIds, members: members.map(member => ({ id: member.userId, name: member.user.name, email: member.user.email })) });
});

export const PUT = withAuthor(async (request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await params;
  const context = await contextFor(kind, id);
  if (!context) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  const mode = body?.mode;
  if (!["GM_ONLY", "PLAYER_SNAPSHOT", "PUBLIC"].includes(mode) || !Array.isArray(body?.userIds) || body.userIds.length > 1000 || body.userIds.some((value: unknown) => typeof value !== "string")) return NextResponse.json({ error: "Choose a valid audience and members." }, { status: 400 });
  const userIds = mode === "PLAYER_SNAPSHOT" ? [...new Set(body.userIds as string[])] : [];
  const activeCount = await prisma.worldMember.count({ where: { worldId: context.worldId, userId: { in: userIds }, status: "ACTIVE" } });
  if (activeCount !== userIds.length) return NextResponse.json({ error: "Selected players must be active members of this world." }, { status: 400 });
  const actor = (await sessionUser())!;
  await prisma.$transaction(async tx => {
    const policy = await tx.audiencePolicy.upsert({ where: { resourceKind_resourceId: { resourceKind: kind, resourceId: id } }, create: { worldId: context.worldId, resourceKind: kind, resourceId: id, mode, createdById: actor.id }, update: { mode } });
    await tx.audienceGrant.deleteMany({ where: { policyId: policy.id } });
    if (userIds.length) await tx.audienceGrant.createMany({ data: userIds.map(userId => ({ policyId: policy.id, userId, grantedById: actor.id })) });
  });
  await recordAuditEvent({ worldId: context.worldId, resourceKind: kind, resourceId: id, action: "set_policy", actorId: actor.id, afterJson: JSON.stringify({ mode, userIds }) });
  return NextResponse.json({ success: true, mode, userIds });
});

export const DELETE = withAuthor(async (_request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await params;
  const context = await contextFor(kind, id);
  if (!context) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.audiencePolicy.deleteMany({ where: { resourceKind: kind, resourceId: id, worldId: context.worldId } });
  return NextResponse.json({ success: true });
});
