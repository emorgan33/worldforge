import { randomUUID } from "node:crypto";
import type { PrismaClient, User, InstallationAdminState, Prisma } from "@prisma/client";
import type { AdminError, InstallationAuditAction } from "./admin-policy";
import { activeAdmin, validateCreateAccountInput, validateRoleChangeInput, validateStatusChangeInput } from "./admin-policy";
import { newToken, tokenHash } from "./passwords";
import {
  appendInstallationAuditEvent,
  recordFailedAdminAttempt,
  logSanitizedAuditFailure,
  type AuditInput,
  type AuditDetails,
} from "./admin-audit";

export type AdminActor =
  | { type: "WEB_ADMIN"; userId: string; sessionId: string }
  | { type: "LOCAL_OPERATOR"; userId?: string | null };

export type AdminMutationTarget = { userId: string; expectedVersion?: number };

export type AdminMutationMode = "default" | "create" | "delete";

export type AdminMutationResult<T> = { ok: true; value: T } | { ok: false; error: AdminError };

export type AdminMutateContext = {
  tx: Prisma.TransactionClient;
  actor: AdminActor;
  target: User;
  singleton: InstallationAdminState;
};

export type AdminMutateResult<T> = { value: T; details?: AuditDetails; reasonCode?: string };

export type AdminMutateFn<T> = (ctx: AdminMutateContext) => Promise<AdminMutateResult<T> | AdminError>;

export type AdminMutationOptions = {
  mode?: AdminMutationMode;
};

export type AdminMutationCheckpoint = (ctx: AdminMutateContext) => Promise<void>;

/** @internal Test-only hooks; never pass from production callers. */
export type AdminMutationTestOptions = AdminMutationOptions & {
  appendAudit?: typeof appendInstallationAuditEvent;
  recordFailure?: typeof recordFailedAdminAttempt;
  beforeTransaction?: (ctx: { actor: AdminActor; targetId: string }) => Promise<void>;
  checkpoint?: AdminMutationCheckpoint;
};

export class AdminMutationRejection extends Error {
  constructor(public readonly adminError: AdminError) {
    super(adminError.error);
    this.name = "AdminMutationRejection";
  }
}

const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 30000 };

function actorIdSnapshot(actor: AdminActor): string | null {
  if (actor.type === "LOCAL_OPERATOR") return actor.userId ?? null;
  return actor.userId;
}

function buildAuditInput(
  actor: AdminActor,
  targetId: string,
  action: InstallationAuditAction,
  outcome: AuditInput["outcome"],
  reasonCode?: string,
  details?: AuditDetails,
): AuditInput {
  return {
    actorType: actor.type,
    actorIdSnapshot: actorIdSnapshot(actor),
    targetIdSnapshot: targetId,
    action,
    outcome,
    reasonCode,
    details: details ?? {},
  };
}

function isConcurrencyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const prismaCode = (error as { code?: string }).code;
  if (prismaCode === "P2034" || prismaCode === "P2024") return true;
  if (prismaCode === "P2028") return false; // timeout, not a retryable conflict
  const message = String((error as { message?: unknown }).message ?? "");
  return /database is locked|busy|deadlock/i.test(message);
}

/** @internal Exposed for tests that need to prove ordering inside the transaction. */
export async function _runAdminMutation<T>(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  action: InstallationAuditAction,
  mutate: AdminMutateFn<T>,
  options?: AdminMutationTestOptions,
): Promise<AdminMutationResult<T>> {
  const mode = options?.mode ?? "default";
  const append = options?.appendAudit ?? appendInstallationAuditEvent;
  const recordFailure = options?.recordFailure ?? recordFailedAdminAttempt;
  const beforeTransaction = options?.beforeTransaction;
  const checkpoint = options?.checkpoint;

  try {
    if (beforeTransaction) {
      await beforeTransaction({ actor, targetId: target.userId });
    }

    const value = await db.$transaction(async (tx) => {
      const singleton = await tx.installationAdminState.update({
        where: { id: 1 },
        data: { version: { increment: 1 } },
      });

      // Test-only hook placed after the singleton lock and before the actor recheck.
      // It lets tests prove the recheck is evaluated inside the transaction.
      if (checkpoint) {
        await checkpoint({ tx, actor, target: { id: target.userId } as User, singleton });
      }

      if (actor.type === "WEB_ADMIN") {
        const session = await tx.authSession.findUnique({
          where: { id: actor.sessionId },
          include: { user: { select: { id: true, role: true, disabledAt: true } } },
        });
        if (!session || session.expiresAt <= new Date()) {
          throw new AdminMutationRejection({ error: "Admin session is no longer valid.", code: "UNAUTHORIZED" });
        }
        if (!session.user || session.user.id !== actor.userId || !activeAdmin(session.user)) {
          throw new AdminMutationRejection({ error: "Admin session is no longer valid.", code: "UNAUTHORIZED" });
        }
      }

      let targetUser: User | null = null;
      if (mode !== "create") {
        targetUser = await tx.user.findUnique({ where: { id: target.userId } });
        if (!targetUser) {
          throw new AdminMutationRejection({ error: "Account not found.", code: "NOT_FOUND" });
        }
        if (target.expectedVersion !== undefined && targetUser.accountVersion !== target.expectedVersion) {
          throw new AdminMutationRejection({ error: "Account state changed. Please refresh.", code: "STALE_ACCOUNT" });
        }
      }

      const ctxTarget = targetUser ?? ({ id: target.userId } as User);
      const ctx: AdminMutateContext = { tx, actor, target: ctxTarget, singleton };

      const mutateResult = await mutate(ctx);
      if ("code" in mutateResult) {
        throw new AdminMutationRejection(mutateResult);
      }

      const auditDetails: AuditDetails = { ...mutateResult.details };
      if (mode === "default") {
        const previousVersion = targetUser!.accountVersion;
        const updatedTarget = await tx.user.update({
          where: { id: targetUser!.id },
          data: { accountVersion: { increment: 1 } },
        });
        auditDetails.previousVersion = previousVersion;
        auditDetails.targetVersion = updatedTarget.accountVersion;
      }

      await append(tx, buildAuditInput(actor, target.userId, action, "SUCCESS", mutateResult.reasonCode, auditDetails));

      return mutateResult.value;
    }, TRANSACTION_OPTIONS);

    return { ok: true, value };
  } catch (error) {
    if (error instanceof AdminMutationRejection) {
      // Unauthorized traffic receives no failure audit and no account detail.
      if (error.adminError.code !== "UNAUTHORIZED") {
        const failureInput = buildAuditInput(actor, target.userId, action, "REJECTED", error.adminError.code);
        try {
          await recordFailure(db, failureInput);
        } catch {
          logSanitizedAuditFailure(action, error.adminError.code);
        }
      }
      return { ok: false, error: error.adminError };
    }

    const concurrent = isConcurrencyError(error);
    const reasonCode = concurrent ? "CONCURRENCY_CONFLICT" : "INTERNAL_ERROR";
    const failureInput = buildAuditInput(actor, target.userId, action, "FAILED", reasonCode);
    try {
      await recordFailure(db, failureInput);
    } catch {
      logSanitizedAuditFailure(action, reasonCode);
    }

    if (concurrent) {
      return { ok: false, error: { error: "Concurrent update detected. Please retry.", code: "CONCURRENCY_CONFLICT" } };
    }
    return { ok: false, error: { error: "Unable to complete this request.", code: "INTERNAL_ERROR" } };
  }
}

/** Production entry point for admin mutations. Tests needing hooks should import `_runAdminMutation`. */
export async function runAdminMutation<T>(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  action: InstallationAuditAction,
  mutate: AdminMutateFn<T>,
  options?: AdminMutationOptions,
): Promise<AdminMutationResult<T>> {
  // Forward only production options so runtime-cast test hooks cannot execute here.
  return _runAdminMutation(db, actor, target, action, mutate, { mode: options?.mode });
}

const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type CreateAccountResult = { userId: string; token: string; expiresAt: Date };

export async function createAccount(
  db: PrismaClient,
  actor: AdminActor,
  body: Record<string, unknown>,
): Promise<AdminMutationResult<CreateAccountResult>> {
  const input = validateCreateAccountInput(body);
  if ("code" in input) return { ok: false, error: input };

  const userId = randomUUID();
  const token = newToken();
  const tokenHashValue = tokenHash(token);

  return runAdminMutation(db, actor, { userId }, "ACCOUNT_CREATE", async (ctx) => {
    const existing = await ctx.tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return { error: "An account with this email already exists.", code: "DUPLICATE_EMAIL" };
    }

    await ctx.tx.user.create({
      data: { id: ctx.target.id, email: input.email, name: input.name, role: input.role, disabledAt: null },
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS);
    await ctx.tx.accountSetup.updateMany({
      where: { userId: ctx.target.id, usedAt: null },
      data: { usedAt: now },
    });
    await ctx.tx.accountSetup.create({
      data: { tokenHash: tokenHashValue, userId: ctx.target.id, expiresAt },
    });

    return { value: { token, expiresAt, userId: ctx.target.id }, details: { role: input.role } };
  }, { mode: "create" });
}

export type IssueRecoveryResult = { token: string; expiresAt: Date };

export async function issueRecovery(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
): Promise<AdminMutationResult<IssueRecoveryResult>> {
  const token = newToken();
  const tokenHashValue = tokenHash(token);
  return runAdminMutation(db, actor, target, "ACCOUNT_RECOVERY", async (ctx) => {
    if (ctx.target.disabledAt !== null) {
      return { error: "Account is disabled.", code: "ACCOUNT_DISABLED" };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS);
    await ctx.tx.accountSetup.updateMany({
      where: { userId: ctx.target.id, usedAt: null },
      data: { usedAt: now },
    });
    await ctx.tx.accountSetup.create({
      data: { tokenHash: tokenHashValue, userId: ctx.target.id, expiresAt },
    });

    return { value: { token, expiresAt } };
  });
}

/** Call only after acquiring the installation singleton lock. */
export async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  target: Pick<User, "role" | "disabledAt">,
): Promise<AdminError | null> {
  if (!activeAdmin(target)) return null;
  const count = await tx.user.count({ where: { role: "ADMIN", disabledAt: null } });
  return count <= 1 ? { error: "The last active administrator cannot be removed.", code: "LAST_ADMIN" } : null;
}

export async function setAccountStatus(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  body: Record<string, unknown>,
): Promise<AdminMutationResult<{ userId: string }>> {
  const input = validateStatusChangeInput(body);
  if ("code" in input) return { ok: false, error: input };

  return runAdminMutation(db, actor, target, "STATUS_CHANGE", async (ctx) => {
    if (input.disabled) {
      if (actor.userId != null && actor.userId === ctx.target.id) {
        return { error: "You cannot disable your own account.", code: "SELF_CHANGE" };
      }
      const guardError = await assertNotLastActiveAdmin(ctx.tx, ctx.target);
      if (guardError) return guardError;

      const now = new Date();
      await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { disabledAt: now } });
      await ctx.tx.authSession.deleteMany({ where: { userId: ctx.target.id } });
      await ctx.tx.accountSetup.updateMany({ where: { userId: ctx.target.id, usedAt: null }, data: { usedAt: now } });
      await ctx.tx.previewSession.updateMany({
        where: { revokedAt: null, OR: [{ userId: ctx.target.id }, { issuedById: ctx.target.id }] },
        data: { revokedAt: now },
      });
    } else {
      await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { disabledAt: null } });
    }
    return {
      value: { userId: ctx.target.id },
      details: { disabled: input.disabled },
      reasonCode: input.disabled ? "DISABLED" : "ENABLED",
    };
  });
}

export async function setAccountRole(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  body: Record<string, unknown>,
): Promise<AdminMutationResult<{ userId: string }>> {
  const input = validateRoleChangeInput(body);
  if ("code" in input) return { ok: false, error: input };

  return runAdminMutation(db, actor, target, "ROLE_CHANGE", async (ctx) => {
    if (ctx.target.role === "ADMIN" && input.role !== "ADMIN") {
      if (actor.userId != null && actor.userId === ctx.target.id) {
        return { error: "You cannot demote your own account.", code: "SELF_CHANGE" };
      }
      const guardError = await assertNotLastActiveAdmin(ctx.tx, ctx.target);
      if (guardError) return guardError;
    }

    if (input.role === "PLAYER" && await ctx.tx.world.count({ where: { ownerId: ctx.target.id } }) > 0) {
      return { error: "Accounts owning worlds cannot become players.", code: "OWNS_WORLDS" };
    }

    const now = new Date();
    await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { role: input.role } });
    await ctx.tx.authSession.deleteMany({ where: { userId: ctx.target.id } });
    await ctx.tx.accountSetup.updateMany({ where: { userId: ctx.target.id, usedAt: null }, data: { usedAt: now } });
    await ctx.tx.previewSession.updateMany({
      where: { revokedAt: null, OR: [{ userId: ctx.target.id }, { issuedById: ctx.target.id }] },
      data: { revokedAt: now },
    });
    return { value: { userId: ctx.target.id }, details: { role: input.role, previousRole: ctx.target.role } };
  });
}

export type TargetSessionList = {
  sessions: { id: string; createdAt: Date; expiresAt: Date; current: boolean }[];
  previewSubjectCount: number;
  previewIssuerCount: number;
};

export async function listTargetSessions(
  db: PrismaClient,
  actor: AdminActor,
  targetUserId: string,
): Promise<AdminMutationResult<TargetSessionList>> {
  try {
    return await db.$transaction(async (tx) => {
      const now = new Date();
      if (actor.type === "WEB_ADMIN") {
        const session = await tx.authSession.findUnique({
          where: { id: actor.sessionId },
          select: { expiresAt: true, user: { select: { id: true, role: true, disabledAt: true } } },
        });
        if (!session || session.expiresAt <= now || session.user.id !== actor.userId || !activeAdmin(session.user)) {
          return { ok: false as const, error: { error: "Admin session is no longer valid.", code: "UNAUTHORIZED" as const } };
        }
      }
      const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
      if (!target) return { ok: false as const, error: { error: "Account not found.", code: "NOT_FOUND" as const } };
      const sessions = await tx.authSession.findMany({
        where: { userId: targetUserId, expiresAt: { gt: now } },
        select: { id: true, createdAt: true, expiresAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const previewSubjectCount = await tx.previewSession.count({ where: { userId: targetUserId, revokedAt: null, expiresAt: { gt: now } } });
      const previewIssuerCount = await tx.previewSession.count({ where: { issuedById: targetUserId, revokedAt: null, expiresAt: { gt: now } } });
      return { ok: true as const, value: {
        sessions: sessions.map((session) => ({ ...session, current: actor.type === "WEB_ADMIN" && session.id === actor.sessionId })),
        previewSubjectCount,
        previewIssuerCount,
      } };
    }, TRANSACTION_OPTIONS);
  } catch {
    return { ok: false, error: { error: "Unable to complete this request.", code: "INTERNAL_ERROR" } };
  }
}

export async function revokeTargetSession(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  sessionId: string,
): Promise<AdminMutationResult<{ revoked: number }>> {
  return runAdminMutation(db, actor, target, "SESSION_REVOKE", async ({ tx, target: user }) => {
    const deleted = await tx.authSession.deleteMany({ where: { id: sessionId, userId: user.id } });
    if (deleted.count === 0) return { error: "Session not found.", code: "NOT_FOUND" };
    return { value: { revoked: deleted.count } };
  });
}

export async function revokeAllTargetSessions(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
): Promise<AdminMutationResult<{ sessionCount: number; previewCount: number }>> {
  return runAdminMutation(db, actor, target, "SESSION_REVOKE_ALL", async ({ tx, target: user }) => {
    const sessions = await tx.authSession.deleteMany({ where: { userId: user.id } });
    const previews = await tx.previewSession.updateMany({
      where: { revokedAt: null, OR: [{ userId: user.id }, { issuedById: user.id }] },
      data: { revokedAt: new Date() },
    });
    const value = { sessionCount: sessions.count, previewCount: previews.count };
    return { value, details: value };
  });
}

export type DeletionPreview = {
  accountVersion: number;
  disabled: boolean;
  worlds: { id: string; title: string; deletedAt: Date | null }[];
  revisionIds: string[];
  foundryImportIds: string[];
  pendingImportIds: string[];
  membershipCount: number;
  grantCount: number;
  sessionCount: number;
  setupCount: number;
  previewCount: number;
  allowed: boolean;
};

export type DeletionError = AdminError & {
  blockers?: {
    worlds?: DeletionPreview["worlds"];
    revisionIds?: string[];
    foundryImportIds?: string[];
    pendingImportIds?: string[];
  };
};

async function loadDeletionPreview(tx: Prisma.TransactionClient, user: Pick<User, "id" | "accountVersion" | "disabledAt">): Promise<DeletionPreview> {
  const worlds = await tx.world.findMany({ where: { ownerId: user.id }, select: { id: true, title: true, deletedAt: true }, orderBy: { id: "asc" } });
  const revisions = await tx.articleRevision.findMany({ where: { userId: user.id }, select: { id: true }, orderBy: { id: "asc" } });
  const foundryImports = await tx.foundryImportRun.findMany({ where: { authorId: user.id }, select: { id: true }, orderBy: { id: "asc" } });
  // Unknown states are conservatively treated as nonterminal.
  const pendingImports = await tx.worldTransferImport.findMany({ where: { ownerId: user.id, status: { notIn: ["COMPLETED", "FAILED"] } }, select: { id: true }, orderBy: { id: "asc" } });
  const membershipCount = await tx.worldMember.count({ where: { userId: user.id } });
  const grantCount = await tx.audienceGrant.count({ where: { userId: user.id } });
  const sessionCount = await tx.authSession.count({ where: { userId: user.id } });
  const setupCount = await tx.accountSetup.count({ where: { userId: user.id } });
  const previewCount = await tx.previewSession.count({ where: { OR: [{ userId: user.id }, { issuedById: user.id }] } });
  return {
    accountVersion: user.accountVersion, disabled: user.disabledAt !== null, worlds,
    revisionIds: revisions.map((item) => item.id), foundryImportIds: foundryImports.map((item) => item.id),
    pendingImportIds: pendingImports.map((item) => item.id), membershipCount, grantCount, sessionCount, setupCount, previewCount,
    allowed: user.disabledAt !== null && worlds.length === 0 && revisions.length === 0 && foundryImports.length === 0 && pendingImports.length === 0,
  };
}

export async function deletionPreview(db: PrismaClient, actor: AdminActor, targetUserId: string): Promise<AdminMutationResult<DeletionPreview>> {
  try {
    return await db.$transaction(async (tx) => {
      if (actor.type === "WEB_ADMIN") {
        const session = await tx.authSession.findUnique({ where: { id: actor.sessionId }, select: { expiresAt: true, user: { select: { id: true, role: true, disabledAt: true } } } });
        if (!session || session.expiresAt <= new Date() || session.user.id !== actor.userId || !activeAdmin(session.user)) {
          return { ok: false as const, error: { error: "Admin session is no longer valid.", code: "UNAUTHORIZED" as const } };
        }
      }
      const user = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, accountVersion: true, disabledAt: true } });
      if (!user) return { ok: false as const, error: { error: "Account not found.", code: "NOT_FOUND" as const } };
      const preview = await loadDeletionPreview(tx, user);
      return { ok: true as const, value: { ...preview, allowed: preview.allowed && actor.userId !== user.id } };
    }, TRANSACTION_OPTIONS);
  } catch {
    return { ok: false, error: { error: "Unable to complete this request.", code: "INTERNAL_ERROR" } };
  }
}

export async function deleteAccount(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  body: Record<string, unknown>,
): Promise<{ ok: true; value: { userId: string } } | { ok: false; error: DeletionError }> {
  if (!Number.isInteger(target.expectedVersion) || (target.expectedVersion ?? -1) < 0 || typeof body.confirmEmail !== "string" || body.backupAcknowledged !== true) {
    return { ok: false, error: { error: "Account version, email confirmation and backup acknowledgement are required.", code: "INVALID_INPUT" } };
  }
  return runAdminMutation<{ userId: string }>(db, actor, target, "ACCOUNT_DELETE", async ({ tx, target: user }) => {
    if (actor.userId != null && actor.userId === user.id) return { error: "You cannot delete your own account.", code: "SELF_CHANGE" };
    if (user.disabledAt === null) return { error: "Disable the account before deleting it.", code: "INVALID_INPUT" };
    if (body.confirmEmail !== user.email) return { error: "Email confirmation does not match.", code: "INVALID_INPUT" };
    const preview = await loadDeletionPreview(tx, user);
    if (preview.worlds.length) return { error: "The account owns worlds.", code: "OWNS_WORLDS", blockers: { worlds: preview.worlds } };
    if (preview.revisionIds.length || preview.foundryImportIds.length || preview.pendingImportIds.length) {
      return { error: "The account has records that prevent deletion.", code: "HAS_DURABLE_RECORDS", blockers: { revisionIds: preview.revisionIds, foundryImportIds: preview.foundryImportIds, pendingImportIds: preview.pendingImportIds } };
    }
    await tx.foundryPreview.deleteMany({ where: { authorId: user.id } });
    await tx.worldTransferImport.deleteMany({ where: { ownerId: user.id, status: { in: ["COMPLETED", "FAILED"] } } });
    await tx.previewSession.updateMany({ where: { issuedById: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.delete({ where: { id: user.id } });
    return { value: { userId: user.id }, details: { worldCount: 0, durableRecordCount: 0, membershipCount: preview.membershipCount, grantCount: preview.grantCount } };
  }, { mode: "delete" });
}
