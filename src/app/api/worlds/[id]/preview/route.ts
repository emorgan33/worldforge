import { cookies } from "next/headers";
import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { issuePreviewSession, revokePreviewSession } from "@/lib/membership";
import { tokenHash } from "@/lib/passwords";

export const POST = withAuthor({ target: "world-param" }, async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, { user }) => {
  const { id: worldId } = await params;
  const body = await request.json();
  const { userId } = body;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const result = await issuePreviewSession(worldId, userId, user.id);
  // Set the preview token as a cookie for the preview middleware
  const jar = await cookies();
  jar.set("wf_preview", result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.WORLDFORGE_ORIGIN || request.url).startsWith("https:"),
    path: "/",
    maxAge: result.expiresIn,
  });
  return NextResponse.json(result);
});

export const DELETE = withAuthor({ target: "world-param" }, async (request: NextRequest, _context, { user, worldId }) => {
  const body = await request.json();
  const { token } = body;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  await revokePreviewSession(tokenHash(token), worldId!, user.id);
  return NextResponse.json({ success: true });
});
