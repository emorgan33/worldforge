import { withAuthor, sessionUser, AccessError } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createPolicy, revokePolicy } from "@/lib/membership";
import { resolveResourceWorld } from "@/lib/access";

export const PUT = withAuthor(async (request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id: resourceId } = await params;
  const body = await request.json();
  const { mode, userIds } = body;
  if (!mode || !["GM_ONLY", "PLAYER_SNAPSHOT", "PUBLIC"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode. Must be GM_ONLY, PLAYER_SNAPSHOT, or PUBLIC." }, { status: 400 });
  }
  const worldId = await resolveResourceWorld(kind, resourceId);
  if (!worldId) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  const user = await sessionUser();
  await createPolicy(worldId, kind, resourceId, mode as "GM_ONLY" | "PLAYER_SNAPSHOT" | "PUBLIC", user!.id, userIds);
  return NextResponse.json({ success: true });
});

export const DELETE = withAuthor(async (request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id: resourceId } = await params;
  const worldId = await resolveResourceWorld(kind, resourceId);
  if (!worldId) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  const user = await sessionUser();
  await revokePolicy(worldId, kind, resourceId, user!.id);
  return NextResponse.json({ success: true });
});
