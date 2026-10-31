import type { Prisma, PrismaClient } from "@prisma/client";
import {
  INSTALLATION_AUDIT_ACTIONS,
  USER_ROLES,
  toSafeAccount,
  type AdminError,
  type InstallationAuditAction,
  type SafeAccount,
  type UserRole,
} from "./admin-policy";

export const DEFAULT_ADMIN_PAGE_SIZE = 25;
export const MAX_ADMIN_PAGE_SIZE = 100;
export const MAX_ADMIN_SEARCH_LENGTH = 254;
export const MAX_ADMIN_CURSOR_LENGTH = 256;

export type AdminUserListQuery = {
  search?: string;
  role?: UserRole;
  status?: "active" | "disabled";
  cursor?: string;
  limit?: number;
};

export type AdminUserList = {
  users: SafeAccount[];
  nextCursor: string | null;
};

export type AdminAccountDetail = {
  account: SafeAccount;
  worlds: { id: string; title: string; deletedAt: Date | null }[];
  membershipCount: number;
  grantCount: number;
  sessionCount: number;
  setupCount: number;
  previewCount: number;
};

export type AdminAuditEntry = {
  id: string;
  actorIdSnapshot: string | null;
  targetIdSnapshot: string | null;
  action: string;
  outcome: string;
  reasonCode: string | null;
  details: Record<string, unknown>;
  actorType: string;
  createdAt: Date;
};

export type AdminAuditList = {
  entries: AdminAuditEntry[];
  nextCursor: string | null;
};

export type AdminAuditQuery = {
  targetId?: string;
  action?: InstallationAuditAction;
  cursor?: string;
  limit?: number;
};

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  disabledAt: true,
  createdAt: true,
  lastSignInAt: true,
  accountVersion: true,
  passwordHash: true,
} as const;

function invalid(message: string): AdminError {
  return { error: message, code: "INVALID_INPUT" };
}

export function parseAdminUserQuery(params: URLSearchParams): AdminUserListQuery | AdminError {
  const query: AdminUserListQuery = {};

  const search = params.get("search") ?? params.get("q");
  if (search !== null) {
    const trimmed = search.trim();
    if (trimmed.length > MAX_ADMIN_SEARCH_LENGTH) return invalid(`Search must be at most ${MAX_ADMIN_SEARCH_LENGTH} characters.`);
    if (trimmed) query.search = trimmed;
  }

  const role = params.get("role");
  if (role !== null && role !== "") {
    if (!USER_ROLES.includes(role as UserRole)) return invalid("Role must be ADMIN, AUTHOR, GM, or PLAYER.");
    query.role = role as UserRole;
  }

  const status = params.get("status");
  if (status !== null && status !== "") {
    if (status !== "active" && status !== "disabled") return invalid("Status must be active or disabled.");
    query.status = status;
  }

  const cursor = params.get("cursor");
  if (cursor !== null && cursor !== "") {
    if (cursor.length > MAX_ADMIN_CURSOR_LENGTH) return invalid("Cursor is invalid.");
    query.cursor = cursor;
  }

  const rawLimit = params.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) return invalid("Limit must be a positive integer.");
    query.limit = Math.min(limit, MAX_ADMIN_PAGE_SIZE);
  }

  return query;
}

export function parseAdminAuditQuery(params: URLSearchParams): AdminAuditQuery | AdminError {
  const query: AdminAuditQuery = {};

  const targetId = params.get("targetId");
  if (targetId !== null && targetId !== "") {
    if (targetId.length > 64) return invalid("Target id is invalid.");
    query.targetId = targetId;
  }

  const action = params.get("action");
  if (action !== null && action !== "") {
    if (!INSTALLATION_AUDIT_ACTIONS.includes(action as InstallationAuditAction)) {
      return invalid("Action is not a known installation audit action.");
    }
    query.action = action as InstallationAuditAction;
  }

  const cursor = params.get("cursor");
  if (cursor !== null && cursor !== "") {
    if (cursor.length > MAX_ADMIN_CURSOR_LENGTH) return invalid("Cursor is invalid.");
    query.cursor = cursor;
  }

  const rawLimit = params.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) return invalid("Limit must be a positive integer.");
    query.limit = Math.min(limit, MAX_ADMIN_PAGE_SIZE);
  }

  return query;
}

type CursorPayload = { createdAt: string; id: string };

export function encodeAdminCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

export function decodeAdminCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.createdAt !== "string" || typeof record.id !== "string") return null;
    if (Number.isNaN(Date.parse(record.createdAt))) return null;
    if (record.id.length === 0 || record.id.length > 64) return null;
    return { createdAt: record.createdAt, id: record.id };
  } catch {
    return null;
  }
}

/**
 * Keyset condition for the `createdAt, id` sort order. Kept as its own AND-ed
 * group so it never merges with a search OR and widens the filters.
 */
function cursorWhere(cursor: CursorPayload): Prisma.UserWhereInput {
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { gt: createdAt } },
      { createdAt, id: { gt: cursor.id } },
    ],
  };
}

function userListWhere(query: AdminUserListQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (query.role) where.role = query.role;
  if (query.status === "active") where.disabledAt = null;
  if (query.status === "disabled") where.disabledAt = { not: null };
  if (query.search) {
    where.OR = [
      { email: { contains: query.search } },
      { name: { contains: query.search } },
    ];
  }
  return where;
}

export async function listAdminUsers(db: PrismaClient, query: AdminUserListQuery): Promise<AdminUserList> {
  const limit = Math.min(query.limit ?? DEFAULT_ADMIN_PAGE_SIZE, MAX_ADMIN_PAGE_SIZE);
  const where = userListWhere(query);

  const cursor = query.cursor ? decodeAdminCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw invalid("Cursor is invalid.");

  // The cursor advances the result set; it must never widen the active filters.
  // Filters and the cursor are separate AND-ed groups so a later page cannot
  // contain rows that the search, role, or status filters excluded.
  const rows = await db.user.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    select: ACCOUNT_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    users: page.map((row) => toSafeAccount(row)),
    nextCursor: rows.length > limit && last ? encodeAdminCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

export async function getAdminAccountDetail(db: PrismaClient, userId: string): Promise<AdminAccountDetail | null> {
  const account = await db.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
  if (!account) return null;

  const [worlds, membershipCount, grantCount, sessionCount, setupCount, previewCount] = await Promise.all([
    db.world.findMany({ where: { ownerId: userId }, select: { id: true, title: true, deletedAt: true }, orderBy: { id: "asc" } }),
    db.worldMember.count({ where: { userId } }),
    db.audienceGrant.count({ where: { userId } }),
    db.authSession.count({ where: { userId } }),
    db.accountSetup.count({ where: { userId } }),
    db.previewSession.count({ where: { OR: [{ userId }, { issuedById: userId }] } }),
  ]);

  return { account: toSafeAccount(account), worlds, membershipCount, grantCount, sessionCount, setupCount, previewCount };
}

const SENSITIVE_DETAIL_KEY = /hash|token|password|secret|credential/i;

/**
 * Audit details are sanitized when written, but the read projection drops
 * anything that looks like credential material as defence in depth so a future
 * write-path mistake cannot leak a hash or token through this endpoint.
 */
function redactAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => redactAuditDetails(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_DETAIL_KEY.test(key)) continue;
      const redacted = redactAuditDetails(entry, depth + 1);
      if (redacted !== undefined) output[key] = redacted;
    }
    return output;
  }
  return value;
}

function parseAuditDetails(detailsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(detailsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const redacted = redactAuditDetails(parsed);
    if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
    return redacted as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function listAdminAuditEvents(db: PrismaClient, query: AdminAuditQuery): Promise<AdminAuditList> {
  const limit = Math.min(query.limit ?? DEFAULT_ADMIN_PAGE_SIZE, MAX_ADMIN_PAGE_SIZE);

  const where: Prisma.InstallationAuditEventWhereInput = {};
  if (query.targetId) where.targetIdSnapshot = query.targetId;
  if (query.action) where.action = query.action;

  const cursor = query.cursor ? decodeAdminCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw invalid("Cursor is invalid.");

  const rows = await db.installationAuditEvent.findMany({
    where: cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { createdAt: { gt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
              ],
            },
          ],
        }
      : where,
    select: {
      id: true,
      actorIdSnapshot: true,
      targetIdSnapshot: true,
      action: true,
      outcome: true,
      reasonCode: true,
      detailsJson: true,
      actorType: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map((row) => ({
      id: row.id,
      actorIdSnapshot: row.actorIdSnapshot,
      targetIdSnapshot: row.targetIdSnapshot,
      action: row.action,
      outcome: row.outcome,
      reasonCode: row.reasonCode,
      details: parseAuditDetails(row.detailsJson),
      actorType: row.actorType,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > limit && last ? encodeAdminCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}
