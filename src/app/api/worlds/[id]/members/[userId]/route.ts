import { withAuthor, sessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { revokeMember } from "@/lib/membership";

export const DELETE = withAuthor(async (request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) => {
  const { id: worldId, userId } = await params;
  const user = await sessionUser();
  await revokeMember(worldId, userId, user!.id);
  return NextResponse.json({ success: true });
});
