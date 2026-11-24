import { resolveActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bookmarkableWorld, isBookmarkKind, playerBookmarks } from "@/lib/player-bookmarks";

const headers = { "Cache-Control": "private, no-store" };

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch { return {}; }
}

function validResourceId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : null;
}

export async function GET() {
  const actor = await resolveActor();
  if (!actor.userId) return Response.json({ error: "Sign in to see saved items." }, { status: 401, headers });
  const items = await playerBookmarks(actor);
  return Response.json({ items }, { headers });
}

export async function POST(request: Request) {
  const actor = await resolveActor();
  if (!actor.userId) return Response.json({ error: "Sign in to save items." }, { status: 401, headers });
  if (actor.kind === "PREVIEW") return Response.json({ error: "Preview sessions cannot save items." }, { status: 403, headers });

  const body = await readBody(request);
  const kind = body.resourceKind;
  const resourceId = validResourceId(body.resourceId);
  if (!isBookmarkKind(kind) || !resourceId) return Response.json({ error: "Choose an article or map to save." }, { status: 400, headers });

  const worldId = await bookmarkableWorld(actor, kind, resourceId);
  if (!worldId) return Response.json({ error: "Not found." }, { status: 404, headers });

  await prisma.playerBookmark.upsert({
    where: { userId_resourceKind_resourceId: { userId: actor.userId, resourceKind: kind, resourceId } },
    create: { userId: actor.userId, worldId, resourceKind: kind, resourceId },
    update: {},
  });
  return Response.json({ saved: true }, { headers });
}

export async function DELETE(request: Request) {
  const actor = await resolveActor();
  if (!actor.userId) return Response.json({ error: "Sign in to change saved items." }, { status: 401, headers });
  if (actor.kind === "PREVIEW") return Response.json({ error: "Preview sessions cannot change saved items." }, { status: 403, headers });

  const body = await readBody(request);
  const kind = body.resourceKind;
  const resourceId = validResourceId(body.resourceId);
  if (!isBookmarkKind(kind) || !resourceId) return Response.json({ error: "Choose an article or map to remove." }, { status: 400, headers });

  await prisma.playerBookmark.deleteMany({ where: { userId: actor.userId, resourceKind: kind, resourceId } });
  return Response.json({ saved: false }, { headers });
}
