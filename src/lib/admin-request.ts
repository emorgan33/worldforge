import { AccessError, sameOrigin } from "./authorization-core";
import { adminAuthFailureResponse, requireAdmin } from "./admin-auth";
import { adminErrorResponse, type AdminError } from "./admin-policy";
import type { AdminActor } from "./admin-accounts";

/**
 * Mutations accept a tiny JSON object. The cap is generous for the documented
 * payloads and small enough that a hostile body cannot be used to exhaust
 * memory before validation.
 */
export const MAX_ADMIN_BODY_BYTES = 8 * 1024;

export type AdminGuardResult =
  | { ok: true; actor: AdminActor; body: Record<string, unknown> }
  | { ok: false; response: Response };

export type AdminBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: AdminError };

function invalid(message: string): AdminError {
  return { error: message, code: "INVALID_INPUT" };
}

/**
 * Read a JSON object whose keys are restricted to `allowed`.
 *
 * Unknown keys are rejected rather than ignored so an attempt to smuggle
 * `passwordHash`, `tokenHash`, `id`, `ownerId`, or a role into an endpoint
 * that does not accept it fails loudly instead of being silently dropped.
 */
export async function readAdminJsonBody(
  request: Request,
  allowed: readonly string[],
): Promise<AdminBodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, error: invalid("Content-Type must be application/json.") };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ADMIN_BODY_BYTES) {
    return { ok: false, error: invalid("Request body is too large.") };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: invalid("Unable to read the request body.") };
  }
  if (Buffer.byteLength(text, "utf-8") > MAX_ADMIN_BODY_BYTES) {
    return { ok: false, error: invalid("Request body is too large.") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: invalid("Request body must be valid JSON.") };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: invalid("Request body must be a JSON object.") };
  }

  const body = parsed as Record<string, unknown>;
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    // Do not echo attacker-controlled key names back.
    return { ok: false, error: invalid(`Only these fields are accepted: ${allowed.join(", ")}.`) };
  }

  return { ok: true, body };
}

/**
 * Origin check, admin capability check, and strict body parsing for a mutation.
 *
 * Order matters: a cross-site request is rejected before any account data is
 * read, and an unauthenticated caller learns nothing about the target.
 */
export async function guardAdminMutation(
  request: Request,
  allowed: readonly string[],
): Promise<AdminGuardResult> {
  try {
    sameOrigin(request);
  } catch (error) {
    if (error instanceof AccessError) {
      const missingOriginConfig = error.status === 500;
      return {
        ok: false,
        response: adminErrorResponse(
          missingOriginConfig
            ? { error: "Server origin is not configured.", code: "INTERNAL_ERROR" }
            : { error: error.message, code: "FORBIDDEN" },
          error.status,
        ),
      };
    }
    throw error;
  }

  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, response: adminAuthFailureResponse(auth.failure) };

  const parsed = await readAdminJsonBody(request, allowed);
  if (!parsed.ok) return { ok: false, response: adminErrorResponse(parsed.error) };

  return { ok: true, actor: auth.actor, body: parsed.body };
}

/** JSON response that must never be cached by a browser or shared proxy. */
export function adminJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * One-time setup URL. The token travels in the URL fragment so it never
 * reaches a server log, referrer, or proxy.
 */
export function setupUrl(request: Request, token: string): string {
  const origin = process.env.WORLDFORGE_ORIGIN || new URL(request.url).origin;
  return `${origin}/setup#token=${encodeURIComponent(token)}`;
}

/** Read the `expectedVersion` field, which every non-create mutation requires. */
export function expectedVersionFrom(body: Record<string, unknown>): number | AdminError {
  const value = body.expectedVersion;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return invalid("expectedVersion must be a non-negative integer.");
  }
  return value;
}
