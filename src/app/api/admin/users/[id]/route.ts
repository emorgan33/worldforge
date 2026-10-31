import { prisma } from "@/lib/db";
import { adminAuthFailureResponse, requireAdmin } from "@/lib/admin-auth";
import { adminErrorResponse } from "@/lib/admin-policy";
import { getAdminAccountDetail } from "@/lib/admin-read";

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
