import { resolveActor } from "@/lib/access";
import { playerActivityFeed } from "@/lib/player-activity";
import { logServerError } from "@/lib/logging";

export async function GET() {
  const actor = await resolveActor();
  if (!actor.userId) return Response.json({ error: "Sign in to see what's new." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const items = await playerActivityFeed(actor);
    return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logServerError("Player activity failed", error);
    return Response.json({ error: "Unable to load what's new." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
