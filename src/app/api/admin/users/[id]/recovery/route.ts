import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin-policy";
import { getSafeAccount } from "@/lib/admin-read";
import { adminJson, expectedVersionFrom, guardAdminMutation, setupUrl } from "@/lib/admin-request";
import { issueRecovery } from "@/lib/admin-accounts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, ["expectedVersion"]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id } = await params;
  const result = await issueRecovery(prisma, guard.actor, { userId: id, expectedVersion });
  if (!result.ok) return adminErrorResponse(result.error);

  const user = await getSafeAccount(prisma, id);
  if (!user) return adminErrorResponse({ error: "Unable to load the account.", code: "INTERNAL_ERROR" });

  return adminJson({
    user,
    setup: { url: setupUrl(request, result.value.token), expiresAt: result.value.expiresAt },
  });
}
