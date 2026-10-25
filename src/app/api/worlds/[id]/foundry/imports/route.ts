import { NextRequest, NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { boundedFoundryJson, createSelectedImport } from "@/lib/foundry/import";

type Context = { params: Promise<unknown> };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
async function postHandler(request: NextRequest, { params }: Context, { user }: { user: { id: string } }) {
  let body: unknown;
  try { body = await boundedFoundryJson(request, 64 * 1024); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid JSON." }, { status: (error as { status?: number })?.status || 400 }); }
  if (!isRecord(body) || typeof body.previewId !== "string" || !Array.isArray(body.candidateIds) || typeof body.idempotencyKey !== "string") return NextResponse.json({ error: "Invalid import request." }, { status: 400 });
  const { id: worldId } = await params as { id: string };
  const result = await createSelectedImport({ worldId, authorId: user.id, previewId: body.previewId, candidateIds: body.candidateIds as string[], idempotencyKey: body.idempotencyKey });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.run, { status: 201 });
}
export const POST = withAuthor({ target: "world-param" }, postHandler);
