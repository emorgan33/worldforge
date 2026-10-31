import { cookies } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE } from "./auth-constants";
import { tokenHash } from "./passwords";
import { activeAdmin, type AdminErrorCode } from "./admin-policy";
import type { AdminActor } from "./admin-accounts";

export type AdminAuthFailure = { error: string; code: AdminErrorCode; status: number };

const UNAUTHORIZED: AdminAuthFailure = {
  error: "Sign in with an administrator account.",
  code: "UNAUTHORIZED",
  status: 401,
};

const FORBIDDEN: AdminAuthFailure = {
  error: "Administrator access is required.",
  code: "FORBIDDEN",
  status: 403,
};

/**
 * Resolve the current session's actor for installation administration.
 *
 * Returns the actor only for a live session belonging to an active ADMIN.
 * A signed-in non-admin is FORBIDDEN; an anonymous, expired, revoked, or
 * disabled caller is UNAUTHORIZED. No account detail is disclosed either way.
 */
export async function requireAdmin(): Promise<
  { ok: true; actor: AdminActor } | { ok: false; failure: AdminAuthFailure }
> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Reject obvious junk before hashing; the bound is deliberately loose so a
  // future token-encoding change does not lock administrators out.
  if (!token || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return { ok: false, failure: UNAUTHORIZED };

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, role: true, disabledAt: true } },
    },
  });
  if (!session || session.expiresAt <= new Date()) return { ok: false, failure: UNAUTHORIZED };
  if (session.user.disabledAt !== null) return { ok: false, failure: UNAUTHORIZED };
  if (!activeAdmin(session.user)) return { ok: false, failure: FORBIDDEN };

  return { ok: true, actor: { type: "WEB_ADMIN", userId: session.user.id, sessionId: session.id } };
}

export function adminAuthFailureResponse(failure: AdminAuthFailure): Response {
  return Response.json(
    { error: failure.error, code: failure.code },
    { status: failure.status, headers: { "Cache-Control": "private, no-store" } },
  );
}
