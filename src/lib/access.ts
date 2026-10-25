import { cookies } from "next/headers";
import { prisma } from "./db";
import { tokenHash } from "./passwords";
import type { Actor, ResourceKind, ResourceRef } from "./access-types";
import { AccessError, sessionUser } from "./authorization-core";
export { AccessError, resolveResourceWorld, sameOrigin } from "./authorization-core";

// ---------------------------------------------------------------------------
// Session-based actor resolution (reliable pattern from original auth.ts)
// ---------------------------------------------------------------------------
export async function resolveActor(): Promise<Actor> {
  const [identity, previewToken] = await Promise.all([
    sessionUser(),
    cookies().then(jar => jar.get("wf_preview")?.value),
  ]);
  // Check preview token cookie
  if (previewToken) {
    const preview = await prisma.previewSession.findUnique({
      where: { tokenHash: tokenHash(previewToken) },
      select: { userId: true, worldId: true, expiresAt: true, revokedAt: true, memberAtGrant: true },
    });
    if (preview && preview.expiresAt > new Date() && !preview.revokedAt && preview.memberAtGrant) {
      return {
        kind: "PREVIEW",
        userId: preview.userId,
        realUserId: identity?.id,
        previewWorldId: preview.worldId,
      };
    }
  }

  if (!identity) return { kind: "ANONYMOUS", userId: null };
  return { kind: "OWNER_GM", userId: identity.id };
}

// ---------------------------------------------------------------------------
// World ownership check (GM-only management)
// ---------------------------------------------------------------------------
export async function requireWorldManage(worldId: string, actor?: Actor): Promise<Actor> {
  const resolved = actor ?? (await resolveActor());
  if (!resolved.userId) throw new AccessError("Sign in to manage this world.", 401);
  const world = await prisma.world.findFirst({
    where: { id: worldId, ownerId: resolved.userId, deletedAt: null },
    select: { id: true },
  });
  if (!world) throw new AccessError("World not found.", 404);
  return resolved;
}

// ---------------------------------------------------------------------------
// Resource-to-world lookup
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Reader access check
// ---------------------------------------------------------------------------
export async function requireReadableResource(ref: ResourceRef, actor?: Actor): Promise<Actor> {
  const resolved = actor ?? (await resolveActor());

  if (!await prisma.world.findFirst({ where: { id: ref.worldId, deletedAt: null }, select: { id: true } })) throw new AccessError("Not found.", 404);

  // Preview capabilities are scoped to one world, rather than impersonating a
  // player across every world to which they belong.
  if (resolved.kind === "PREVIEW" && resolved.previewWorldId !== ref.worldId) {
    throw new AccessError("Not found.", 404);
  }

  if (resolved.kind === "ANONYMOUS") {
    if (ref.kind !== "articles") throw new AccessError("Not found.", 404);
    const article = await prisma.article.findUnique({
      where: { id: ref.id },
      select: { publicationStatus: true, visibility: true, world: { select: { isPublic: true, deletedAt: true } } },
    });
    if (!article || article.world.deletedAt || article.publicationStatus !== "PUBLISHED" || article.visibility !== "PUBLIC" || !article.world.isPublic) {
      throw new AccessError("Not found.", 404);
    }
    return resolved;
  }

  const worldId = ref.worldId;
  const isOwner = await prisma.world.findFirst({
    where: { id: worldId, ownerId: resolved.userId!, deletedAt: null },
    select: { id: true },
  });
  if (isOwner) return { ...resolved, kind: "OWNER_GM" };

  const member = await prisma.worldMember.findFirst({
    where: { worldId, userId: resolved.userId!, status: "ACTIVE", world: { deletedAt: null } },
    select: { id: true },
  });
  if (!member) throw new AccessError("Not found.", 404);

  const policy = await prisma.audiencePolicy.findUnique({
    where: { resourceKind_resourceId: { resourceKind: ref.kind, resourceId: ref.id } },
    select: { mode: true },
  });
  if (!policy || policy.mode === "GM_ONLY") throw new AccessError("Not found.", 404);
  if (policy.mode === "PUBLIC") return { ...resolved, kind: "PLAYER" };

  const grant = await prisma.audienceGrant.findFirst({
    where: { policy: { resourceKind: ref.kind, resourceId: ref.id }, userId: resolved.userId!, revokedAt: null },
    select: { id: true },
  });
  if (!grant) throw new AccessError("Not found.", 404);
  return { ...resolved, kind: "PLAYER" };
}

// ---------------------------------------------------------------------------
// Prisma WHERE builder for list queries
// ---------------------------------------------------------------------------
export async function readableWhere(worldId: string, kind: ResourceKind, actor?: Actor): Promise<{ where: Record<string, unknown> }> {
  const resolved = actor ?? (await resolveActor());
  if (resolved.kind === "ANONYMOUS") {
    return { where: { worldId, publicationStatus: "PUBLISHED", visibility: "PUBLIC", world: { isPublic: true, deletedAt: null } } };
  }
  const isOwner = await prisma.world.findFirst({
    where: { id: worldId, ownerId: resolved.userId!, deletedAt: null },
    select: { id: true },
  });
  if (isOwner) return { where: { worldId } };
  if (resolved.kind === "PREVIEW" && resolved.previewWorldId !== worldId) return { where: { id: "__NONE__" } };
  const member = await prisma.worldMember.findFirst({
    where: { worldId, userId: resolved.userId!, status: "ACTIVE", world: { deletedAt: null } },
    select: { id: true },
  });
  if (!member) return { where: { id: "__NONE__" } };
  const policies = await prisma.audiencePolicy.findMany({
    where: {
      worldId,
      resourceKind: kind,
      OR: [
        { mode: "PUBLIC" },
        { mode: "PLAYER_SNAPSHOT", grants: { some: { userId: resolved.userId!, revokedAt: null } } },
      ],
    },
    select: { resourceId: true },
  });
  return { where: { worldId, id: { in: policies.map(policy => policy.resourceId) } } };
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------
export function notFoundResponse(body?: unknown): Response {
  return Response.json(body ?? { error: "Not found." }, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------
// Same-origin check
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Existence predicate for efficient query-level pre-filtering
// ---------------------------------------------------------------------------
export function readableExists(_actor: Actor): Record<string, unknown> {
  void _actor;
  return {};
}

// ---------------------------------------------------------------------------
// Helper: check if an actor can read a specific entity reference
// ---------------------------------------------------------------------------
export async function canReadEntity(
  actor: Actor | null | undefined,
  worldId: string,
  kind: ResourceKind,
  entityId: string
): Promise<boolean> {
  if (!actor || !actor.userId) {
    // Anonymous: only public resources in public worlds
    try {
      await requireReadableResource({ worldId, kind, id: entityId }, { kind: "ANONYMOUS", userId: null });
      return true;
    } catch {
      return false;
    }
  }

  if (actor.kind === "OWNER_GM") {
    // Owner/GM can read anything in their world
    const world = await prisma.world.findFirst({
      where: { id: worldId, ownerId: actor.userId, deletedAt: null },
      select: { id: true },
    });
    if (world) return true;
  }

  try {
    await requireReadableResource({ worldId, kind, id: entityId }, actor);
    return true;
  } catch {
    return false;
  }
}
