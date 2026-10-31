import type { Prisma, PrismaClient } from "@prisma/client";
import type { InstallationAuditAction, InstallationAuditActorType, InstallationAuditOutcome } from "./admin-policy";

export type AuditDetails = Record<string, unknown>;

export type AuditInput = {
  actorType: InstallationAuditActorType;
  actorIdSnapshot: string | null;
  targetIdSnapshot: string | null;
  action: InstallationAuditAction;
  outcome: InstallationAuditOutcome;
  reasonCode?: string;
  details: AuditDetails;
};

const MAX_REASON_CODE = 80;
const MAX_SNAPSHOT_ID = 64;
const MAX_DETAIL_STRING = 500;

// Globally allowed detail keys written by the mutation core.
const GLOBAL_ALLOWED_DETAIL_KEYS = new Set(["targetVersion", "previousVersion"]);

// Action-specific allowlist. Unknown keys are dropped before persistence.
const ACTION_ALLOWED_DETAIL_KEYS: Partial<Record<InstallationAuditAction, Set<string>>> = {
  ACCOUNT_CREATE: new Set(["role", "emailDomain"]),
  ACCOUNT_RECOVERY: new Set([]),
  STATUS_CHANGE: new Set(["disabled", "reason"]),
  ROLE_CHANGE: new Set(["role", "previousRole"]),
  SESSION_REVOKE: new Set([]),
  SESSION_REVOKE_ALL: new Set(["sessionCount", "previewCount"]),
  ACCOUNT_DELETE: new Set(["worldCount", "durableRecordCount", "membershipCount", "grantCount"]),
  BOOTSTRAP: new Set([]),
  LOCAL_RECOVERY: new Set(["reason"]),
};

function sanitizeString(value: string, maxLength: number): string {
  if (value.length > maxLength) return value.slice(0, maxLength);
  return value;
}

export function sanitizeSnapshotId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return sanitizeString(value, MAX_SNAPSHOT_ID);
}

export function sanitizeReasonCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return sanitizeString(value, MAX_REASON_CODE);
}

function sanitizeAuditValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeString(value, MAX_DETAIL_STRING);
  // Arrays and objects are not allowed in audit details.
  return undefined;
}

export function sanitizeAuditDetails(action: InstallationAuditAction, input: AuditDetails): AuditDetails {
  const allowed = new Set([
    ...GLOBAL_ALLOWED_DETAIL_KEYS,
    ...(ACTION_ALLOWED_DETAIL_KEYS[action] ?? []),
  ]);
  const output: AuditDetails = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    const sanitized = sanitizeAuditValue(value);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export async function appendInstallationAuditEvent(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await tx.installationAuditEvent.create({
    data: {
      actorIdSnapshot: sanitizeSnapshotId(input.actorIdSnapshot),
      targetIdSnapshot: sanitizeSnapshotId(input.targetIdSnapshot),
      action: input.action,
      outcome: input.outcome,
      reasonCode: sanitizeReasonCode(input.reasonCode),
      detailsJson: JSON.stringify(sanitizeAuditDetails(input.action, input.details)),
      actorType: input.actorType,
    },
  });
}

export function logSanitizedAuditFailure(action: InstallationAuditAction, reasonCode?: string): void {
  // Emit a sanitized operational error — no exception text, no IDs, no bodies.
  console.error("[admin-audit] failure audit persistence failed", { action, reasonCode });
}

export async function recordFailedAdminAttempt(
  db: PrismaClient,
  input: AuditInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await appendInstallationAuditEvent(tx, input);
  });
}
