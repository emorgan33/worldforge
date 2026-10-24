import { unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "./db";
import { newToken, tokenHash } from "./passwords";
import { SESSION_COOKIE, SESSION_SECONDS } from "./auth-constants";

export class AccessError extends Error { constructor(message: string, public status = 404) { super(message); } }

// EXACT original - no parameters, just cookies()
export async function sessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await prisma.authSession.findUnique({ where: { tokenHash: tokenHash(token) }, select: { expiresAt: true, user: { select: { id: true, email: true, name: true, role: true } } } });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WORLDFORGE_ORIGIN || `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new AccessError("This request must come from this site.", 403);
}

export async function ownedWorld(worldId: unknown, userId?: string) {
  const actor = userId || (await sessionUser())?.id;
  if (!actor) throw new AccessError("Sign in to access your workspace.", 401);
  if (typeof worldId !== "string" || !await prisma.world.findFirst({ where: { id: worldId, ownerId: actor, deletedAt: null }, select: { id: true } })) throw new AccessError("Not found.");
}

export async function ownedArchivedWorld(worldId: unknown, userId?: string) {
  const actor = userId || (await sessionUser())?.id;
  if (!actor) throw new AccessError("Sign in to manage this world.", 401);
  if (typeof worldId !== "string" || !await prisma.world.findFirst({ where: { id: worldId, ownerId: actor, deletedAt: { not: null } }, select: { id: true } })) throw new AccessError("Not found.");
}

export async function issueSession(userId: string, request: Request) {
  const token = newToken();
  await prisma.authSession.create({ data: { userId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: (process.env.WORLDFORGE_ORIGIN || request.url).startsWith("https:"), path: "/", maxAge: SESSION_SECONDS });
}

export async function revokeSession() {
  const jar = await cookies(); const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
  jar.delete(SESSION_COOKIE);
}

async function resourceWorld(kind: string, id: string): Promise<string | null> {
  switch (kind) {
    case "articles": return (await prisma.article.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    case "statblocks": return (await prisma.rpgBlock.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    case "assets": return (await prisma.imageAsset.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    case "secrets": return (await prisma.secret.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    case "maps": return (await prisma.map.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    case "map-layers": return (await prisma.mapLayer.findUnique({ where: { id }, select: { map: { select: { worldId: true } } } }))?.map.worldId || null;
    case "map-markers": return (await prisma.marker.findUnique({ where: { id }, select: { map: { select: { worldId: true } } } }))?.map.worldId || null;
    case "map-elements": return (await prisma.mapElement.findUnique({ where: { id }, select: { map: { select: { worldId: true } } } }))?.map.worldId || null;
    case "collection": return (await prisma.variableCollection.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    case "variable": return (await prisma.variable.findUnique({ where: { id }, select: { collection: { select: { worldId: true } } } }))?.collection.worldId || null;
    case "sessions": return (await prisma.campaignSession.findUnique({ where: { id }, select: { worldId: true } }))?.worldId || null;
    default: return null;
  }
}

async function authorize(request: NextRequest, userId: string, role: string) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const [, , resource, id, ...rest] = segments;

  // Handle resources/[kind]/[id]/... routes
  if (resource === "resources") {
    const kind = id;                   // e.g. "articles"
    const resourceId = rest[0];        // the actual resource ID
    if (resourceId) {
      if (!["GET", "HEAD"].includes(request.method)) sameOrigin(request);
      const worldId = await resourceWorld(kind, resourceId);
      await ownedWorld(worldId, userId);
      return;
    }
  }

  if (["GET", "HEAD"].includes(request.method)) {
    if (role === "PLAYER") throw new AccessError("Player accounts cannot access author APIs.", 403);
    if (resource === "worlds") {
      // For nested routes like /api/worlds/[id]/export, check ownership
      if (id === "deleted" && rest.length === 0) return;
      if (rest.length > 0) await ownedWorld(id, userId);
      return;
    }
    // Author detail endpoints include GM-only fields. Player reads use the
    // dedicated, filtered /c reader and /api/c endpoints instead.
    const worldId = id ? await resourceWorld(resource, id) : url.searchParams.get("worldId");
    // Every author collection requires an explicit owned world. Several list
    // handlers otherwise treat a missing worldId as an unrestricted query.
    if (!worldId) throw new AccessError("Not found.");
    await ownedWorld(worldId, userId);
    return;
  }
  sameOrigin(request);
  if (role === "PLAYER") throw new AccessError("Player accounts cannot manage worlds.", 403);
  // Collection-level world writes are the only routes whose target is not in
  // the URL. Keep nested world routes and resource authorization path-bound.
  if (resource === "worlds" && id === undefined && rest.length === 0) {
    if (request.method === "POST") return;
    if (request.method === "PATCH") {
      const body = await request.clone().json().catch(() => { throw new AccessError("Invalid JSON.", 400); });
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { id?: unknown }).id !== "string" || !(body as { id: string }).id) throw new AccessError("A world ID is required.", 400);
      await ownedWorld((body as { id: string }).id, userId);
      return;
    }
  }
  if (resource === "assets" && request.method === "POST") return;

  // For world routes, the world ID is in the URL path (e.g. /api/worlds/[id]/members)
  if (resource === "worlds") {
    if (id === "import" && rest.length === 0 && request.method === "POST") return;
    if (rest.length === 1 && ["restore", "purge", "hard"].includes(rest[0]) && ((rest[0] === "restore" && request.method === "POST") || (rest[0] === "purge" && request.method === "POST") || (rest[0] === "hard" && request.method === "DELETE"))) await ownedArchivedWorld(id, userId);
    else await ownedWorld(id, userId);
    return;
  }

  let worldId: unknown = null;
  if (id) {
    // The target is in the URL, so resolve its world from the database and do
    // not require a JSON body. Bodyless resource actions (for example
    // POST /api/articles/[id]/clone) must still authorize.
    worldId = await resourceWorld(resource, id);
  } else {
    const body = await request.clone().json().catch(() => { throw new AccessError("Invalid JSON.", 400); });
    if (!body || typeof body !== "object") throw new AccessError("Invalid request.", 400);
    const fields = body as Record<string, unknown>;
    worldId = fields.worldId;
    if (resource === "maps") {
      const mapId = typeof fields.mapId === "string" ? fields.mapId : typeof fields.id === "string" ? fields.id : "";
      if (!worldId) worldId = await resourceWorld("maps", mapId);
    } else if (resource === "variables") worldId = await resourceWorld(request.method === "POST" ? "collection" : "variable", (fields.collectionId as string) || (fields.id as string) || "");
    else if (resource === "secrets" && request.method === "PATCH") worldId = await resourceWorld("secrets", (fields.id as string) || "");
  }
  await ownedWorld(worldId, userId);
}

export function withAuthor<H>(handler: H): H {
  return (async (request: NextRequest, context: unknown) => {
    try {
      const user = await sessionUser();
      if (!user) throw new AccessError("Sign in to access your workspace.", 401);
      await authorize(request, user.id, user.role);
      const response = await (handler as (request: NextRequest, context: unknown) => Promise<Response>)(request, context);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (error) {
      unstable_rethrow(error);
      if (!(error instanceof AccessError)) console.error("Author request failed", error);
      return Response.json({ error: error instanceof AccessError ? error.message : "Unable to complete this request." }, { status: error instanceof AccessError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
    }
  }) as H;
}
