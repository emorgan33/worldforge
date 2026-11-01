import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin-policy";
import { adminJson, expectedVersionFrom, guardAdminMutation } from "@/lib/admin-request";
import { revokeTargetSession } from "@/lib/admin-accounts";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const guard = await guardAdminMutation(request, ["expectedVersion"]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id, sessionId } = await params;
  // The service scopes the delete to the target, so a session ID belonging to
  // another account is a 404 and is never revoked.
  const result = await revokeTargetSession(
    prisma,
    guard.actor,
    { userId: id, expectedVersion },
    sessionId,
  );
  if (!result.ok) return adminErrorResponse(result.error);

  return adminJson(result.value);
}
