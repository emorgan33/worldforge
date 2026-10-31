import { prisma } from "@/lib/db";
import { adminAuthFailureResponse, requireAdmin } from "@/lib/admin-auth";
import { adminErrorResponse } from "@/lib/admin-policy";
import { deletionPreview } from "@/lib/admin-accounts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return adminAuthFailureResponse(auth.failure);

  const { id } = await params;
  const result = await deletionPreview(prisma, auth.actor, id);
  if (!result.ok) return adminErrorResponse(result.error);

  return Response.json(result.value, { headers: { "Cache-Control": "private, no-store" } });
}
