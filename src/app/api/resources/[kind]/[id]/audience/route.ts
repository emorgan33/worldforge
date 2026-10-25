import { withAuthorResource } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";

const KINDS = ["articles", "statblocks", "secrets", "maps", "assets"] as const;
type ShareableKind = typeof KINDS[number];

function routeHandlers(kind: ShareableKind) {
  return {
    GET: withAuthorResource(kind, async (_request: NextRequest, _context, { worldId, resourceId: id }) => {
  const [policy, members] = await Promise.all([
    prisma.audiencePolicy.findUnique({ where: { resourceKind_resourceId: { resourceKind: kind, resourceId: id } }, select: { mode: true, grants: { where: { revokedAt: null }, select: { userId: true } } } }),
    prisma.worldMember.findMany({ where: { worldId, status: "ACTIVE" }, select: { userId: true, user: { select: { name: true, email: true } } }, orderBy: { joinedAt: "asc" } }),
  ]);
  const activeIds = new Set(members.map(member => member.userId));
  const userIds = policy?.mode === "PUBLIC" ? members.map(member => member.userId) : (policy?.grants ?? []).map(grant => grant.userId).filter(id => activeIds.has(id));
  return NextResponse.json({ mode: policy?.mode ?? "GM_ONLY", userIds, members: members.map(member => ({ id: member.userId, name: member.user.name, email: member.user.email })) });
    }),

    PUT: withAuthorResource(kind, async (request: NextRequest, _context, { worldId, resourceId: id, user: actor }) => {
  const body = await request.json().catch(() => null);
  const mode = body?.mode;
  if (!["GM_ONLY", "PLAYER_SNAPSHOT", "PUBLIC"].includes(mode) || !Array.isArray(body?.userIds) || body.userIds.length > 1000 || body.userIds.some((value: unknown) => typeof value !== "string")) return NextResponse.json({ error: "Choose a valid audience and members." }, { status: 400 });
  const userIds = mode === "PLAYER_SNAPSHOT" ? [...new Set(body.userIds as string[])] : [];
  const activeCount = await prisma.worldMember.count({ where: { worldId, userId: { in: userIds }, status: "ACTIVE" } });
  if (activeCount !== userIds.length) return NextResponse.json({ error: "Selected players must be active members of this world." }, { status: 400 });
  await prisma.$transaction(async tx => {
    const policy = await tx.audiencePolicy.upsert({ where: { resourceKind_resourceId: { resourceKind: kind, resourceId: id } }, create: { worldId, resourceKind: kind, resourceId: id, mode, createdById: actor.id }, update: { mode } });
    await tx.audienceGrant.deleteMany({ where: { policyId: policy.id } });
    if (userIds.length) await tx.audienceGrant.createMany({ data: userIds.map(userId => ({ policyId: policy.id, userId, grantedById: actor.id })) });
  });
  await recordAuditEvent({ worldId, resourceKind: kind, resourceId: id, action: "set_policy", actorId: actor.id, afterJson: JSON.stringify({ mode, userIds }) });
  return NextResponse.json({ success: true, mode, userIds });
    }),

    DELETE: withAuthorResource(kind, async (_request: NextRequest, _context, { worldId, resourceId: id }) => {
  await prisma.audiencePolicy.deleteMany({ where: { resourceKind: kind, resourceId: id, worldId } });
  return NextResponse.json({ success: true });
    }),
  };
}

const handlers = Object.fromEntries(KINDS.map(kind => [kind, routeHandlers(kind)])) as Record<ShareableKind, ReturnType<typeof routeHandlers>>;

export async function GET(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }) {
  const { kind } = await context.params;
  return (handlers as Record<string, ReturnType<typeof routeHandlers>>)[kind]?.GET(request, context as never)
    ?? NextResponse.json({ error: "Not found." }, { status: 404 });
}
export async function PUT(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }) {
  const { kind } = await context.params;
  return (handlers as Record<string, ReturnType<typeof routeHandlers>>)[kind]?.PUT(request, context as never)
    ?? NextResponse.json({ error: "Not found." }, { status: 404 });
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }) {
  const { kind } = await context.params;
  return (handlers as Record<string, ReturnType<typeof routeHandlers>>)[kind]?.DELETE(request, context as never)
    ?? NextResponse.json({ error: "Not found." }, { status: 404 });
}
