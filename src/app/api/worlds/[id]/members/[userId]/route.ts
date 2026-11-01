import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { revokeMember } from "@/lib/membership";

export const DELETE = withAuthor({ target: "world-param" }, async (request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }, { user }) => {
  const { id: worldId, userId } = await params;
  await revokeMember(worldId, userId, user.id);
  return NextResponse.json({ success: true });
});
