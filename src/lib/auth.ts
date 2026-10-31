import { unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "./db";
import { newToken, tokenHash } from "./passwords";
import { SESSION_COOKIE, SESSION_SECONDS } from "./auth-constants";
import { AccessError, resolveResourceWorld, sameOrigin, sessionUser, type ResourceKind } from "./authorization-core";
export { AccessError, sameOrigin, sessionUser } from "./authorization-core";

// EXACT original - no parameters, just cookies()
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
  const previewToken = jar.get("wf_preview")?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
  if (previewToken) await prisma.previewSession.updateMany({ where: { tokenHash: tokenHash(previewToken), revokedAt: null }, data: { revokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
  jar.delete("wf_preview");
}

type AuthorDeclaration =
  | { target: "account" }
  | { target: "world-param"; archived?: boolean }
  | { target: "world-query"; field: string }
  | { target: "world-body"; field: string }
  | { target: "world-form"; field: string; readForm: (request: Request) => Promise<FormData> }
  | { target: "map-action-body"; worldField: string; mapField: string }
  | { target: "resource-body"; kind: ResourceKind; field: string }
  | { target: "resource-param"; kind: ResourceKind; archived?: boolean }
  | { target: "resource-route"; kinds: readonly ResourceKind[] };
export type AuthorizedRoute = { user: NonNullable<Awaited<ReturnType<typeof sessionUser>>>; worldId?: string; resourceId?: string; formData?: FormData };

export function withAuthor<C = unknown>(
  declaration: AuthorDeclaration,
  handler: (request: NextRequest, context: C, authorized: AuthorizedRoute) => Promise<Response>,
): (request: NextRequest, context: C) => Promise<Response> {
  return async (request: NextRequest, context: C) => {
    try {
      const user = await sessionUser();
      if (!user) throw new AccessError("Sign in to access your workspace.", 401);
      if (user.role === "PLAYER" && declaration.target !== "resource-route") throw new AccessError("Player accounts cannot access author APIs.", 403);
      if (!["GET", "HEAD"].includes(request.method)) sameOrigin(request);
      let authorizedWorldId: string | null = null;
      let authorizedResourceId: string | undefined;
      let authorizedFormData: FormData | undefined;
      if (declaration.target === "world-param") {
        const params = await (context as { params?: Promise<Record<string, string>> }).params;
        const worldId = params?.id;
        authorizedWorldId = typeof worldId === "string" ? worldId : null;
        if (declaration.archived) await ownedArchivedWorld(worldId, user.id);
        else await ownedWorld(worldId, user.id);
      } else if (declaration.target === "resource-param") {
        const params = await (context as { params?: Promise<Record<string, string>> }).params;
        const worldId = await resolveResourceWorld(declaration.kind, params?.id ?? "");
        authorizedResourceId = params?.id;
        authorizedWorldId = worldId;
        if (declaration.archived) await ownedArchivedWorld(worldId, user.id);
        else await ownedWorld(worldId, user.id);
      } else if (declaration.target === "world-query") {
        const worldId = new URL(request.url).searchParams.get(declaration.field);
        authorizedWorldId = worldId;
        await ownedWorld(worldId, user.id);
      } else if (declaration.target === "world-body") {
        const body = await request.clone().json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Invalid request.", 400);
        const worldId = (body as Record<string, unknown>)[declaration.field];
        authorizedWorldId = typeof worldId === "string" ? worldId : null;
        await ownedWorld(worldId, user.id);
      } else if (declaration.target === "world-form") {
        try {
          authorizedFormData = await declaration.readForm(request);
        } catch (error) {
          const status = (error as { status?: unknown })?.status;
          if (error instanceof Error && typeof status === "number") throw new AccessError(error.message, status);
          throw error;
        }
        const worldId = authorizedFormData.get(declaration.field);
        authorizedWorldId = typeof worldId === "string" ? worldId : null;
        await ownedWorld(worldId, user.id);
      } else if (declaration.target === "map-action-body") {
        const body = await request.clone().json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Invalid request.", 400);
        const fields = body as Record<string, unknown>;
        const providedWorldId = fields[declaration.worldField];
        const mapId = fields[declaration.mapField];
        const mapWorldId = typeof mapId === "string" && mapId ? await resolveResourceWorld("maps", mapId) : null;
        if (typeof providedWorldId === "string" && mapWorldId && providedWorldId !== mapWorldId) throw new AccessError("Not found.");
        const worldId = mapWorldId ?? (typeof providedWorldId === "string" ? providedWorldId : null);
        authorizedWorldId = worldId;
        await ownedWorld(worldId, user.id);
      } else if (declaration.target === "resource-body") {
        const body = await request.clone().json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Invalid request.", 400);
        const fields = body as Record<string, unknown>;
        const worldId = await resolveResourceWorld(declaration.kind, typeof fields[declaration.field] === "string" ? fields[declaration.field] as string : "");
        authorizedWorldId = worldId;
        if (typeof fields.worldId === "string" && fields.worldId !== worldId) throw new AccessError("Not found.");
        await ownedWorld(worldId, user.id);
      } else if (declaration.target === "resource-route") {
        const params = await (context as { params?: Promise<Record<string, string>> }).params;
        const kind = params?.kind ?? "";
        if (!declaration.kinds.includes(kind as ResourceKind)) throw new AccessError("Not found.");
        const resourceId = params?.id ?? "";
        const worldId = await resolveResourceWorld(kind, resourceId);
        authorizedResourceId = resourceId;
        authorizedWorldId = worldId;
        await ownedWorld(worldId, user.id);
      }
      const response = await handler(request, context, { user, ...(authorizedWorldId ? { worldId: authorizedWorldId } : {}), ...(authorizedResourceId ? { resourceId: authorizedResourceId } : {}), ...(authorizedFormData ? { formData: authorizedFormData } : {}) });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (error) {
      unstable_rethrow(error);
      if (!(error instanceof AccessError)) console.error("Author request failed", error);
      return Response.json({ error: error instanceof AccessError ? error.message : "Unable to complete this request." }, { status: error instanceof AccessError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}

type ResourceRouteContext = { params: Promise<{ kind: string; id: string }> };
type AuthorizedResource = { user: NonNullable<Awaited<ReturnType<typeof sessionUser>>>; worldId: string; resourceId: string };

/** Explicit authorization for a resource route; it does not inspect URL segments or request bodies. */
export function withAuthorResource(
  kind: ResourceKind,
  handler: (request: NextRequest, context: ResourceRouteContext, authorized: AuthorizedResource) => Promise<Response>,
): (request: NextRequest, context: ResourceRouteContext) => Promise<Response> {
  return withAuthor({ target: "resource-route", kinds: [kind] }, async (request, context, authorized) =>
    handler(request, context as ResourceRouteContext, { user: authorized.user, worldId: authorized.worldId!, resourceId: authorized.resourceId! }),
  );
}
