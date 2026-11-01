import { NextRequest, NextResponse } from "next/server";
import { withAuthor } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFoundrySources } from "@/lib/foundry/parse";
import { boundedFoundryJson, FOUNDRY_MAX_CANDIDATES, storePreview } from "@/lib/foundry/import";
import type { FoundryMetadata } from "@/lib/foundry/types";

type Context = { params: Promise<unknown> };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

async function postHandler(request: NextRequest, { params }: Context, { user }: { user: { id: string } }) {
  let parsed: unknown;
  try { parsed = await boundedFoundryJson(request); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: (error as { status?: number })?.status || 400 }); }
  if (!isRecord(parsed) || !Array.isArray(parsed.files) || !isRecord(parsed.metadata)) return NextResponse.json({ error: "Provide files and source metadata." }, { status: 400 });
  const files = parsed.files;
  if (files.length < 1 || files.length > 100 || files.some(file => !isRecord(file) || typeof file.name !== "string" || typeof file.text !== "string")) return NextResponse.json({ error: "Provide between 1 and 100 text files." }, { status: 400 });
  const metadata = parsed.metadata as unknown as FoundryMetadata;
  if (metadata.system !== "pf2e" || typeof metadata.systemVersion !== "string" || typeof metadata.foundryVersion !== "string" || typeof metadata.remaster !== "boolean" || typeof metadata.namespace !== "string" || metadata.namespace.length < 1 || metadata.namespace.length > 200) return NextResponse.json({ error: "This import currently requires valid Pathfinder 2e source metadata." }, { status: 400 });
  try {
    const { id: worldId } = await params as { id: string };
    const world = await prisma.world.findFirst({ where: { id: worldId }, select: { system: true } });
    if (world?.system !== "PF_2E") return NextResponse.json({ error: "Pathfinder 2e imports require a Pathfinder 2e world." }, { status: 400 });
    const candidates = parseFoundrySources(files as { name: string; text: string }[], metadata);
    if (!Array.isArray(candidates) || candidates.length > FOUNDRY_MAX_CANDIDATES) return NextResponse.json({ error: "Too many items in this source." }, { status: 400 });
    try {
      const result = await storePreview({ worldId, authorId: user.id, metadata, candidates });
      return NextResponse.json(result, { status: 201 });
    } catch {
      return NextResponse.json({ error: "Unable to save Foundry preview." }, { status: 500 });
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview Foundry source." }, { status: 400 }); }
}

export const POST = withAuthor({ target: "world-param" }, postHandler);
