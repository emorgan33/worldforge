import { prisma } from "@/lib/db";
import { adminAuthFailureResponse, requireAdmin } from "@/lib/admin-auth";
import { adminErrorResponse, isAdminError } from "@/lib/admin-policy";
import { getSafeAccount, listAdminUsers, parseAdminUserQuery } from "@/lib/admin-read";
import { adminJson, guardAdminMutation, setupUrl } from "@/lib/admin-request";
import { createAccount } from "@/lib/admin-accounts";

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

export async function POST(request: Request) {
  const guard = await guardAdminMutation(request, ["email", "name", "role"]);
  if (!guard.ok) return guard.response;

  const result = await createAccount(prisma, guard.actor, guard.body);
  if (!result.ok) return adminErrorResponse(result.error);

  const user = await getSafeAccount(prisma, result.value.userId);
  if (!user) return adminErrorResponse({ error: "Unable to load the new account.", code: "INTERNAL_ERROR" });

  return adminJson(
    {
      user,
      setup: { url: setupUrl(request, result.value.token), expiresAt: result.value.expiresAt },
    },
    201,
  );
}
