import { cookies } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE } from "./auth-constants";
import { tokenHash } from "./passwords";
import type { ResourceKind } from "./access-types";
export type { ResourceKind } from "./access-types";

export class AccessError extends Error {
  constructor(message: string, public status = 404) {
    super(message);
    this.name = "AccessError";
  }
}

const RESOURCE_KINDS = new Set<ResourceKind>([
  "articles", "statblocks", "secrets", "maps", "assets", "map-layers",
  "map-markers", "map-elements", "collection", "variable", "sessions", "campaign_sessions",
]);

export function isResourceKind(kind: string): kind is ResourceKind {
  return RESOURCE_KINDS.has(kind as ResourceKind);
}

export async function sessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { expiresAt: true, user: { select: { id: true, email: true, name: true, role: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !process.env.WORLDFORGE_ORIGIN) throw new AccessError("Public origin is not configured.", 500);
  const expected = process.env.WORLDFORGE_ORIGIN || `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AccessError("This request must come from this site.", 403);
  }
}

export async function resolveResourceWorld(kind: string, id: string): Promise<string | null> {
  if (!isResourceKind(kind) || !id) return null;
  switch (kind) {
    case "articles": return (await prisma.article.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "statblocks": return (await prisma.rpgBlock.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "assets": return (await prisma.imageAsset.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "secrets": return (await prisma.secret.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "maps": return (await prisma.map.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "map-layers": return (await prisma.mapLayer.findUnique({ where: { id }, select: { map: { select: { worldId: true } } } }))?.map.worldId ?? null;
    case "map-markers": return (await prisma.marker.findUnique({ where: { id }, select: { map: { select: { worldId: true } } } }))?.map.worldId ?? null;
    case "map-elements": return (await prisma.mapElement.findUnique({ where: { id }, select: { map: { select: { worldId: true } } } }))?.map.worldId ?? null;
    case "collection": return (await prisma.variableCollection.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
    case "variable": return (await prisma.variable.findUnique({ where: { id }, select: { collection: { select: { worldId: true } } } }))?.collection.worldId ?? null;
    case "sessions": case "campaign_sessions":
      return (await prisma.campaignSession.findUnique({ where: { id }, select: { worldId: true } }))?.worldId ?? null;
  }
}
