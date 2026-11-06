import type { User } from "@prisma/client";

export const USER_ROLES = ["ADMIN", "AUTHOR", "GM", "PLAYER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CREATABLE_ROLES = ["AUTHOR", "PLAYER"] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

export const ADMIN_ERROR_CODES = [
  "LAST_ADMIN",
  "SELF_CHANGE",
  "ACCOUNT_DISABLED",
  "OWNS_WORLDS",
  "HAS_DURABLE_RECORDS",
  "STALE_ACCOUNT",
  "STALE_WORLD",
  "INVALID_ROLE",
  "INVALID_INPUT",
  "DUPLICATE_EMAIL",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONCURRENCY_CONFLICT",
  "INTERNAL_ERROR",
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

export type AdminError = { error: string; code: AdminErrorCode };

export type SafeAccount = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  disabledAt: Date | null;
  createdAt: Date;
  lastSignInAt: Date | null;
  accountVersion: number;
  setupPending: boolean;
};

export type InstallationAuditActorType = "WEB_ADMIN" | "LOCAL_OPERATOR";

export const INSTALLATION_AUDIT_ACTIONS = [
  "ACCOUNT_CREATE",
  "ACCOUNT_RECOVERY",
  "STATUS_CHANGE",
  "ROLE_CHANGE",
  "SESSION_REVOKE",
  "SESSION_REVOKE_ALL",
  "ACCOUNT_DELETE",
  "WORLD_TRANSFER",
  "WORLD_PURGE",
  "BOOTSTRAP",
  "LOCAL_RECOVERY",
] as const;
export type InstallationAuditAction = (typeof INSTALLATION_AUDIT_ACTIONS)[number];

export const INSTALLATION_AUDIT_OUTCOMES = ["SUCCESS", "REJECTED", "FAILED"] as const;
export type InstallationAuditOutcome = (typeof INSTALLATION_AUDIT_OUTCOMES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_NAME = 120;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed) || trimmed.length > MAX_EMAIL) return null;
  return trimmed;
}

export function validName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME) return null;
  return trimmed;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isCreatableRole(value: unknown): value is CreatableRole {
  return typeof value === "string" && CREATABLE_ROLES.includes(value as CreatableRole);
}

export function activeAdmin(user: Pick<User, "role" | "disabledAt">): boolean {
  return user.role === "ADMIN" && user.disabledAt === null;
}

export function disabled(user: Pick<User, "disabledAt">): boolean {
  return user.disabledAt !== null;
}

export function setupPending(user: Pick<User, "passwordHash">): boolean {
  return user.passwordHash === null || user.passwordHash === "";
}

export function toSafeAccount(user: Pick<User, "id" | "email" | "name" | "role" | "disabledAt" | "createdAt" | "lastSignInAt" | "accountVersion" | "passwordHash">): SafeAccount {
  if (!isUserRole(user.role)) throw new Error(`Unexpected user role: ${user.role}`);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt,
    accountVersion: user.accountVersion,
    setupPending: setupPending(user),
  };
}

export function validateCreateAccountInput(body: Record<string, unknown>): { email: string; name: string; role: CreatableRole } | AdminError {
  const email = normalizeEmail(body.email);
  if (!email) return { error: "A valid email address is required.", code: "INVALID_INPUT" };
  const name = validName(body.name);
  if (!name) return { error: "Name must be between 1 and 120 characters.", code: "INVALID_INPUT" };
  const role = body.role;
  if (!isCreatableRole(role)) return { error: "New accounts may only be AUTHOR or PLAYER.", code: "INVALID_ROLE" };
  return { email, name, role };
}

export function validateRoleChangeInput(body: Record<string, unknown>): { role: UserRole } | AdminError {
  const role = body.role;
  if (!isUserRole(role)) return { error: "Role must be ADMIN, AUTHOR, GM, or PLAYER.", code: "INVALID_ROLE" };
  return { role };
}

export function validateStatusChangeInput(body: Record<string, unknown>): { disabled: boolean } | AdminError {
  if (typeof body.disabled !== "boolean") return { error: "disabled must be a boolean.", code: "INVALID_INPUT" };
  return { disabled: body.disabled };
}

export function validateExpectedVersion(body: Record<string, unknown>): number | AdminError {
  if (typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) {
    return { error: "expectedVersion must be a non-negative integer.", code: "INVALID_INPUT" };
  }
  return body.expectedVersion;
}

/** Map a service error code onto the documented HTTP status. */
export function adminErrorStatus(code: AdminErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED": return 401;
    case "FORBIDDEN": return 403;
    case "NOT_FOUND": return 404;
    case "INVALID_INPUT":
    case "INVALID_ROLE": return 400;
    case "LAST_ADMIN":
    case "SELF_CHANGE":
    case "ACCOUNT_DISABLED":
    case "OWNS_WORLDS":
    case "HAS_DURABLE_RECORDS":
    case "STALE_ACCOUNT":
    case "STALE_WORLD":
    case "DUPLICATE_EMAIL": return 409;
    case "CONCURRENCY_CONFLICT": return 503;
    default: return 500;
  }
}

export function adminErrorResponse(error: AdminError, status?: number): Response {
  const resolved = status ?? adminErrorStatus(error.code);
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  if (resolved === 503) headers["Retry-After"] = "2";
  return Response.json({ error: error.error, code: error.code }, { status: resolved, headers });
}

export function isAdminError(value: unknown): value is AdminError {
  if (typeof value !== "object" || value === null) return false;
  const { error, code } = value as Record<string, unknown>;
  return typeof error === "string" && typeof code === "string" && ADMIN_ERROR_CODES.includes(code as AdminErrorCode);
}
