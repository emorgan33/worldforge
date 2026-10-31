import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin-policy";
import { getSafeAccount } from "@/lib/admin-read";
import { adminJson, expectedVersionFrom, guardAdminMutation } from "@/lib/admin-request";
import { setAccountRole } from "@/lib/admin-accounts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, ["role", "expectedVersion"]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id } = await params;
  const result = await setAccountRole(
    prisma,
    guard.actor,
    { userId: id, expectedVersion },
    guard.body,
  );
  if (!result.ok) return adminErrorResponse(result.error);

  const user = await getSafeAccount(prisma, id);
  if (!user) return adminErrorResponse({ error: "Unable to load the account.", code: "INTERNAL_ERROR" });

  return adminJson({ user });
}
