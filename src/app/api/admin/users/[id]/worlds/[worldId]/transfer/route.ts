import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin-policy";
import { getSafeAccount } from "@/lib/admin-read";
import { adminJson, expectedVersionFrom, guardAdminMutation } from "@/lib/admin-request";
import { transferOwnedWorld } from "@/lib/admin-accounts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; worldId: string }> }) {
  const guard = await guardAdminMutation(request, ["recipientId", "expectedVersion"]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id, worldId } = await params;
  const result = await transferOwnedWorld(
    prisma,
    guard.actor,
    { userId: id, expectedVersion },
    worldId,
    guard.body,
  );
  if (!result.ok) return adminErrorResponse(result.error);

  const user = await getSafeAccount(prisma, id);
  if (!user) return adminErrorResponse({ error: "Unable to load the account.", code: "INTERNAL_ERROR" });

  return adminJson({ user, world: { id: result.value.worldId, title: result.value.worldTitle } });
}
