import { randomUUID } from "node:crypto";
import type { PrismaClient, User, InstallationAdminState, Prisma } from "@prisma/client";
import type { AdminError, InstallationAuditAction } from "./admin-policy";
import { activeAdmin, validateCreateAccountInput } from "./admin-policy";
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
