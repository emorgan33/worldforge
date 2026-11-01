import { NextRequest, NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { getImportRun } from "@/lib/foundry/import";

type Context = { params: Promise<unknown> };
async function getHandler(_request: NextRequest, { params }: Context, { user }: { user: { id: string } }) {
  const { id: worldId, runId } = await params as { id: string; runId: string };
  const result = await getImportRun(worldId, user.id, runId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Import run not found." }, { status: 404 });
}
export const GET = withAuthor({ target: "world-param" }, getHandler);
