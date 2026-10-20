import { NextRequest, NextResponse } from "next/server";
import { withAuthor, sessionUser } from "@/lib/auth";
import { getPreviewItems } from "@/lib/foundry/import";

type Context = { params: Promise<unknown> };
async function getHandler(_request: NextRequest, { params }: Context) {
  const { id: worldId, previewId } = await params as { id: string; previewId: string };
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to access your workspace." }, { status: 401 });
  const result = await getPreviewItems(worldId, user.id, previewId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Preview not found or expired." }, { status: 404 });
}
export const GET = withAuthor(getHandler);
