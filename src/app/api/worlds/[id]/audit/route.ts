import { withAuthor } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getAuditEvents } from "@/lib/audit";

export const GET = withAuthor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: worldId } = await params;
  const events = await getAuditEvents(worldId);
  return NextResponse.json({ events });
});
