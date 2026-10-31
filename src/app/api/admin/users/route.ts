import { prisma } from "@/lib/db";
import { adminAuthFailureResponse, requireAdmin } from "@/lib/admin-auth";
import { adminErrorResponse, isAdminError } from "@/lib/admin-policy";
import { listAdminUsers, parseAdminUserQuery } from "@/lib/admin-read";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return adminAuthFailureResponse(auth.failure);

  const parsed = parseAdminUserQuery(new URL(request.url).searchParams);
  if (isAdminError(parsed)) return adminErrorResponse(parsed);

  try {
    const page = await listAdminUsers(prisma, parsed);
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isAdminError(error)) return adminErrorResponse(error);
    return adminErrorResponse({ error: "Unable to list accounts.", code: "INTERNAL_ERROR" });
  }
}
