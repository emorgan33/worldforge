import { NextRequest, NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { getPreviewItems } from "@/lib/foundry/import";

type Context = { params: Promise<unknown> };
async function getHandler(_request: NextRequest, { params }: Context, { user }: { user: { id: string } }) {
  const { id: worldId, previewId } = await params as { id: string; previewId: string };
  const result = await getPreviewItems(worldId, user.id, previewId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Preview not found or expired." }, { status: 404 });
}
export const GET = withAuthor({ target: "world-param" }, getHandler);
