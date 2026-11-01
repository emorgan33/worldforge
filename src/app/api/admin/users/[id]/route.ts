import { prisma } from "@/lib/db";
import { adminAuthFailureResponse, requireAdmin } from "@/lib/admin-auth";
import { adminErrorResponse, adminErrorStatus } from "@/lib/admin-policy";
import { getAdminAccountDetail } from "@/lib/admin-read";
import { adminJson, expectedVersionFrom, guardAdminMutation } from "@/lib/admin-request";
import { deleteAccount } from "@/lib/admin-accounts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return adminAuthFailureResponse(auth.failure);

  try {
    const { id } = await params;
    const detail = await getAdminAccountDetail(prisma, id);
    if (!detail) return adminErrorResponse({ error: "Account not found.", code: "NOT_FOUND" });

    return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return adminErrorResponse({ error: "Unable to load account.", code: "INTERNAL_ERROR" });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, [
    "expectedVersion",
    "confirmEmail",
    "backupAcknowledged",
  ]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id } = await params;
  const result = await deleteAccount(
    prisma,
    guard.actor,
    { userId: id, expectedVersion },
    guard.body,
  );
  if (!result.ok) {
    const { blockers, ...error } = result.error;
    return adminJson(
      blockers ? { ...error, blockers } : error,
      adminErrorStatus(error.code),
    );
  }

  return adminJson({ deleted: true, userId: result.value.userId });
}
