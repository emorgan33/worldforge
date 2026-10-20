import { cookies } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE } from "./auth-constants";
import { tokenHash } from "./passwords";
import type { Actor, ActorKind, ResourceRef } from "./access-types";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------
export class AccessError extends Error {
  constructor(message: string, public status: number = 404) {
    super(message);
    this.name = "AccessError";
  }
}

// ---------------------------------------------------------------------------
// Session-based actor resolution (reliable pattern from original auth.ts)
// ---------------------------------------------------------------------------
async function sessionUserFromToken(token: string) {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { expiresAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export async function resolveActor(): Promise<Actor> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Check preview token cookie
  const previewToken = jar.get("wf_preview")?.value;
  if (previewToken) {
    const preview = await prisma.previewSession.findUnique({
      where: { tokenHash: tokenHash(previewToken) },
      select: { userId: true, worldId: true, expiresAt: true, revokedAt: true, memberAtGrant: true },
    });
    if (preview && preview.expiresAt > new Date() && !preview.revokedAt && preview.memberAtGrant) {
      return {
        kind: "PREVIEW",
        userId: preview.userId,
        realUserId: token ? (await sessionUserFromToken(token))?.id ?? undefined : undefined,
        previewWorldId: preview.worldId,
      };
    }
  }

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { kind: "ANONYMOUS", userId: null };
  const user = await sessionUserFromToken(token);
  if (!user) return { kind: "ANONYMOUS", userId: null };
  return { kind: "OWNER_GM", userId: user.id };
}

// Legacy sessionUser for backward compatibility
export async function sessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { expiresAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
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
export async function resolveResourceWorld(kind: string, id: string): Promise<string | null> {
  switch (kind) {
    case "articles":
      return (await prisma.article.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "statblocks":
      return (await prisma.rpgBlock.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "secrets":
      return (await prisma.secret.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "maps":
      return (await prisma.map.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "collection":
      return (await prisma.variableCollection.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "variable":
      return (await prisma.variable.findUnique({ where: { id }, select: { collection: { select: { worldId: true } } } }))?.collection.worldId ?? null;
    case "assets":
      return (await prisma.imageAsset.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "campaign_sessions":
      return (await prisma.campaignSession.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    default:
      return null;
  }
}

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
export async function readableWhere(worldId: string, kind: string, actor?: Actor): Promise<{ where: Record<string, unknown> }> {
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
export function sameOrigin(request: Request): void {
  const url = new URL(request.url);
  const expected = process.env.WORLDFORGE_ORIGIN || `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (request.headers.get("origin") !== expected) {
    throw new AccessError("This request must come from this site.", 403);
  }
}

// ---------------------------------------------------------------------------
// Existence predicate for efficient query-level pre-filtering
// ---------------------------------------------------------------------------
export function readableExists(_actor: Actor): Record<string, unknown> {
  return {};
}

// ---------------------------------------------------------------------------
// Helper: check if an actor can read a specific entity reference
// ---------------------------------------------------------------------------
export async function canReadEntity(
  actor: Actor | null | undefined,
  worldId: string,
  kind: string,
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
