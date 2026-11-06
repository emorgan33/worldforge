import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin-policy";
import { getSafeAccount } from "@/lib/admin-read";
import { adminJson, expectedVersionFrom, guardAdminMutation } from "@/lib/admin-request";
import { purgeOwnedWorld } from "@/lib/admin-accounts";
import { drainAssetCleanupJobs } from "@/lib/world-management";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; worldId: string }> }) {
  const guard = await guardAdminMutation(request, ["confirmWorldTitle", "backupAcknowledged", "expectedVersion"]);
  if (!guard.ok) return guard.response;

  const expectedVersion = expectedVersionFrom(guard.body);
  if (typeof expectedVersion !== "number") return adminErrorResponse(expectedVersion);

  const { id, worldId } = await params;
  const result = await purgeOwnedWorld(
    prisma,
    guard.actor,
    { userId: id, expectedVersion },
    worldId,
    guard.body,
  );
  if (!result.ok) return adminErrorResponse(result.error);

  // The purge commits before file cleanup. A cleanup failure must not report the
  // already-completed purge as failed; durable jobs retry on a later drain.
  let assetCleanup: Awaited<ReturnType<typeof drainAssetCleanupJobs>> | null = null;
  try {
    assetCleanup = await drainAssetCleanupJobs();
  } catch (error) {
    console.error("Failed to drain asset cleanup jobs after admin world purge:", error);
  }

  const user = await getSafeAccount(prisma, id);
  if (!user) return adminErrorResponse({ error: "Unable to load the account.", code: "INTERNAL_ERROR" });

  return adminJson({
    user,
    world: { id: result.value.worldId, title: result.value.worldTitle },
    assetCleanup,
  });
}
