import { NextRequest, NextResponse } from "next/server";
import { withAuthor, sessionUser } from "@/lib/auth";
import { getImportRun } from "@/lib/foundry/import";

type Context = { params: Promise<unknown> };
async function getHandler(_request: NextRequest, { params }: Context) {
  const { id: worldId, runId } = await params as { id: string; runId: string };
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to access your workspace." }, { status: 401 });
  const result = await getImportRun(worldId, user.id, runId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Import run not found." }, { status: 404 });
}
export const GET = withAuthor(getHandler);
