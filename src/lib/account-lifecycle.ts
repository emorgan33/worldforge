import type { Prisma, PrismaClient } from "@prisma/client";

const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 30000 };

export class AccountEligibilityError extends Error {
  constructor(message = "This account is not eligible for this action.") {
    super(message);
    this.name = "AccountEligibilityError";
  }
}

export class AccountLifecycleConflictError extends Error {
  constructor() {
    super("Account state changed during this request. Please retry.");
    this.name = "AccountLifecycleConflictError";
  }
}

function isRetryableTransactionConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2034" || code === "P2024") return true;
  if (code === "P2028") return false;
  return /database is locked|database is busy|deadlock/i.test(String((error as { message?: unknown }).message ?? ""));
}

/** Serialize auth and world-creation eligibility checks with admin lifecycle mutations. */
export async function withAccountLifecycleLock<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.installationAdminState.update({
        where: { id: 1 },
        data: { version: { increment: 1 } },
      });
      return operation(tx);
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isRetryableTransactionConflict(error)) throw new AccountLifecycleConflictError();
    throw error;
  }
}

export async function requireActiveAccount(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, disabledAt: true, passwordHash: true, accountVersion: true },
  });
  if (!user || user.disabledAt !== null) throw new AccountEligibilityError();
  return user;
}

export async function findActiveSessionActor(tx: Prisma.TransactionClient, sessionTokenHash: string) {
  const session = await tx.authSession.findUnique({
    where: { tokenHash: sessionTokenHash },
    select: { userId: true, expiresAt: true, user: { select: { id: true, role: true, disabledAt: true } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.id !== session.userId || session.user.disabledAt !== null) return null;
  return { id: session.user.id, role: session.user.role };
}

export async function requireActiveAuthor(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await requireActiveAccount(tx, userId);
  if (!["ADMIN", "AUTHOR", "GM"].includes(user.role)) throw new AccountEligibilityError();
  return user;
}
