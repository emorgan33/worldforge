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

const SENSITIVE_KEYS = new Set([
  "token",
  "tokenhash",
  "password",
  "passwordhash",
  "cookie",
  "session",
  "body",
  "url",
  "hash",
  "secret",
  "setupurl",
]);

const TOKEN_LIKE_RE = /^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64}|[a-f0-9]{128})$/i;
const URL_TOKEN_RE = /[?#]token=/i;
const BEARER_RE = /^bearer\s+/i;

export function sanitizeAuditDetails(input: AuditDetails): AuditDetails {
  const output: AuditDetails = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    output[key] = sanitizeAuditValue(value);
  }
  return output;
}

function sanitizeAuditValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (TOKEN_LIKE_RE.test(value) || URL_TOKEN_RE.test(value) || BEARER_RE.test(value)) {
      return "[REDACTED]";
    }
    if (value.length > 500) return value.slice(0, 500);
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value !== null && typeof value === "object") return sanitizeAuditDetails(value as AuditDetails);
  return value;
}

export async function appendInstallationAuditEvent(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await tx.installationAuditEvent.create({
    data: {
      actorIdSnapshot: input.actorIdSnapshot ?? null,
      targetIdSnapshot: input.targetIdSnapshot ?? null,
      action: input.action,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? null,
      detailsJson: JSON.stringify(sanitizeAuditDetails(input.details)),
      actorType: input.actorType,
    },
  });
}

export async function recordFailedAdminAttempt(
  db: PrismaClient,
  input: AuditInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await appendInstallationAuditEvent(tx, input);
  });
}
