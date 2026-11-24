import { resolveActor, sameOrigin, AccessError } from "@/lib/access";
import { prisma } from "@/lib/db";
import { noteFields, playerNotes, resolveNoteTarget, NOTE_LIMIT } from "@/lib/player-notes";

const noStore = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  console.error("Notebook request failed:", error);
  return Response.json({ error: "Unable to update the notebook." }, { status: 500, headers: noStore });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch { return {}; }
}

function validId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : null;
}

/** Session-only; GM preview sessions are rejected rather than shown a real account's notes. */
function requireWriter(actor: Awaited<ReturnType<typeof resolveActor>>) {
  if (!actor.userId) throw new AccessError("Sign in to use your notebook.", 401);
  if (actor.kind === "PREVIEW") throw new AccessError("Preview sessions cannot use the notebook.", 403);
  return actor.userId;
}

export async function GET() {
  try {
    const actor = await resolveActor();
    requireWriter(actor);
    return Response.json({ notes: await playerNotes(actor) }, { headers: noStore });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await resolveActor();
    requireWriter(actor);
    const body = await readBody(request);
    const fields = noteFields(body);
    if (!fields) return Response.json({ error: "Give the note a title (up to 200 characters) and text up to 20,000 characters." }, { status: 400, headers: noStore });
    const target = await resolveNoteTarget(actor, body);
    if (!target) return Response.json({ error: "That campaign or reference is not available to you." }, { status: 400, headers: noStore });
    if (await prisma.playerNote.count({ where: { userId: actor.userId! } }) >= NOTE_LIMIT) {
      return Response.json({ error: `Your notebook is full (${NOTE_LIMIT} notes). Delete a note to add another.` }, { status: 400, headers: noStore });
    }

    const note = await prisma.playerNote.create({
      data: { userId: actor.userId!, title: fields.title, content: fields.content, worldId: target.worldId, resourceKind: target.resourceKind, resourceId: target.resourceId },
      select: { id: true, version: true, worldId: true },
    });
    return Response.json({ note }, { status: 201, headers: noStore });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const actor = await resolveActor();
    requireWriter(actor);
    const body = await readBody(request);
    const id = validId(body.id);
    const version = body.version;
    if (!id || typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return Response.json({ error: "Choose a note to update." }, { status: 400, headers: noStore });
    }
    const fields = noteFields(body);
    if (!fields) return Response.json({ error: "Give the note a title (up to 200 characters) and text up to 20,000 characters." }, { status: 400, headers: noStore });

    const existing = await prisma.playerNote.findFirst({ where: { id, userId: actor.userId! }, select: { resourceKind: true, worldId: true } });
    if (!existing) return Response.json({ error: "Note not found." }, { status: 404, headers: noStore });
    // A referenced note's campaign follows its reference; standalone notes may
    // change campaign (or drop it) only to a campaign the player can read.
    let worldId = existing.worldId;
    if (!existing.resourceKind && body.worldId !== undefined) {
      const target = await resolveNoteTarget(actor, { worldId: body.worldId });
      if (!target) return Response.json({ error: "That campaign is not available to you." }, { status: 400, headers: noStore });
      worldId = target.worldId;
    }

    const updated = await prisma.playerNote.updateMany({
      where: { id, userId: actor.userId!, version },
      data: { title: fields.title, content: fields.content, worldId, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const current = await prisma.playerNote.findFirst({ where: { id, userId: actor.userId! }, select: { title: true, content: true, version: true, updatedAt: true } });
      if (!current) return Response.json({ error: "Note not found." }, { status: 404, headers: noStore });
      return Response.json({ error: "This note changed on another device.", note: { ...current, updatedAt: current.updatedAt.toISOString() } }, { status: 409, headers: noStore });
    }
    return Response.json({ saved: true, version: version + 1 }, { headers: noStore });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const actor = await resolveActor();
    requireWriter(actor);
    const body = await readBody(request);
    const id = validId(body.id);
    if (!id) return Response.json({ error: "Choose a note to delete." }, { status: 400, headers: noStore });
    await prisma.playerNote.deleteMany({ where: { id, userId: actor.userId! } });
    return Response.json({ deleted: true }, { headers: noStore });
  } catch (error) { return failure(error); }
}
