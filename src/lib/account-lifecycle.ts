import type { Prisma, PrismaClient } from "@prisma/client";

const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 30000 };

export class AccountEligibilityError extends Error {
  constructor(message = "This account is not eligible for this action.") {
    super(message);
    this.name = "AccountEligibilityError";
  }
}

/** Serialize auth and world-creation eligibility checks with admin lifecycle mutations. */
export async function withAccountLifecycleLock<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.installationAdminState.update({
      where: { id: 1 },
      data: { version: { increment: 1 } },
    });
    return operation(tx);
  }, TRANSACTION_OPTIONS);
}

export async function requireActiveAccount(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, disabledAt: true },
  });
  if (!user || user.disabledAt !== null) throw new AccountEligibilityError();
  return user;
}

export async function requireActiveAuthor(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await requireActiveAccount(tx, userId);
  if (!["ADMIN", "AUTHOR", "GM"].includes(user.role)) throw new AccountEligibilityError();
  return user;
}
