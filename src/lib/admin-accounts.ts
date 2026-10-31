import type { PrismaClient, User, InstallationAdminState, Prisma } from "@prisma/client";
import type { AdminError, InstallationAuditAction } from "./admin-policy";
import { activeAdmin } from "./admin-policy";
import { appendInstallationAuditEvent, recordFailedAdminAttempt, type AuditInput, type AuditDetails } from "./admin-audit";

export type AdminActor =
  | { type: "WEB_ADMIN"; userId: string; sessionId: string }
  | { type: "LOCAL_OPERATOR"; userId?: string | null };

export type AdminMutationTarget = { userId: string; expectedVersion?: number };

export type AdminMutationResult<T> = { ok: true; value: T } | { ok: false; error: AdminError };

export type AdminMutateContext = {
  tx: Prisma.TransactionClient;
  actor: AdminActor;
  target: User;
  singleton: InstallationAdminState;
};

export type AdminMutateResult<T> = { value: T; details?: AuditDetails; reasonCode?: string };

export type AdminMutateFn<T> = (ctx: AdminMutateContext) => Promise<AdminMutateResult<T> | AdminError>;

export type AdminMutationCheckpoint = (ctx: AdminMutateContext) => Promise<void>;

export type AdminMutationOptions = {
  appendAudit?: typeof appendInstallationAuditEvent;
  recordFailure?: typeof recordFailedAdminAttempt;
  checkpoint?: AdminMutationCheckpoint;
};

export class AdminMutationRejection extends Error {
  constructor(public readonly adminError: AdminError) {
    super(adminError.error);
    this.name = "AdminMutationRejection";
  }
}

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
  const message = String((error as { message?: unknown }).message ?? "");
  return /database is locked|busy|transaction|deadlock/i.test(message);
}

export async function runAdminMutation<T>(
  db: PrismaClient,
  actor: AdminActor,
  target: AdminMutationTarget,
  action: InstallationAuditAction,
  mutate: AdminMutateFn<T>,
  options?: AdminMutationOptions,
): Promise<AdminMutationResult<T>> {
  const append = options?.appendAudit ?? appendInstallationAuditEvent;
  const recordFailure = options?.recordFailure ?? recordFailedAdminAttempt;
  const checkpoint = options?.checkpoint;

  try {
    const value = await db.$transaction(async (tx) => {
      const singleton = await tx.installationAdminState.update({
        where: { id: 1 },
        data: { version: { increment: 1 } },
      });

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

      const targetUser = await tx.user.findUnique({ where: { id: target.userId } });
      if (!targetUser) {
        throw new AdminMutationRejection({ error: "Account not found.", code: "NOT_FOUND" });
      }
      if (target.expectedVersion !== undefined && targetUser.accountVersion !== target.expectedVersion) {
        throw new AdminMutationRejection({ error: "Account state changed. Please refresh.", code: "STALE_ACCOUNT" });
      }

      const ctx: AdminMutateContext = { tx, actor, target: targetUser, singleton };
      if (checkpoint) await checkpoint(ctx);

      const mutateResult = await mutate(ctx);
      if ("code" in mutateResult) {
        throw new AdminMutationRejection(mutateResult);
      }

      const updatedTarget = await tx.user.update({
        where: { id: targetUser.id },
        data: { accountVersion: { increment: 1 } },
      });

      const auditDetails: AuditDetails = {
        ...mutateResult.details,
        previousVersion: targetUser.accountVersion,
        targetVersion: updatedTarget.accountVersion,
      };

      await append(tx, buildAuditInput(actor, targetUser.id, action, "SUCCESS", mutateResult.reasonCode, auditDetails));

      return mutateResult.value;
    });

    return { ok: true, value };
  } catch (error) {
    if (error instanceof AdminMutationRejection) {
      const failureInput = buildAuditInput(actor, target.userId, action, "REJECTED", error.adminError.code);
      try {
        await recordFailure(db, failureInput);
      } catch {
        // Best-effort failure audit failed; return sanitized error below.
      }
      return { ok: false, error: error.adminError };
    }

    const concurrent = isConcurrencyError(error);
    const reasonCode = concurrent ? "CONCURRENCY_CONFLICT" : "INTERNAL_ERROR";
    const failureInput = buildAuditInput(actor, target.userId, action, "FAILED", reasonCode);
    try {
      await recordFailure(db, failureInput);
    } catch {
      // Failure audit persistence failed; fall through to generic error.
    }

    if (concurrent) {
      return { ok: false, error: { error: "Concurrent update detected. Please retry.", code: "CONCURRENCY_CONFLICT" } };
    }
    return { ok: false, error: { error: "Unable to complete this request.", code: "INTERNAL_ERROR" } };
  }
}
