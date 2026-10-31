import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin-policy";
import { adminJson, expectedVersionFrom, guardAdminMutation } from "@/lib/admin-request";
import { revokeAllTargetSessions } from "@/lib/admin-accounts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, ["expectedVersion"]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id } = await params;
  const result = await revokeAllTargetSessions(prisma, guard.actor, { userId: id, expectedVersion });
  if (!result.ok) return adminErrorResponse(result.error);

  return adminJson(result.value);
}
