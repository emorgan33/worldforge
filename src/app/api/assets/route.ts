import { withAuthor, AccessError } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ASSET_SOURCE_FILTERS, assetSourceWhere, assetUrl, IMAGE_ACCEPT, isAssetId, type AssetSourceFilter, type ImageAssetProvenanceSummary } from "@/lib/assets";
import { AssetInputError, normalizeImage, readImageForm, removeAssetFile, writeAsset } from "@/lib/asset-storage";

import { provenanceVerificationOrigin } from "@/lib/stock-provenance";

const provenanceSelect = { catalogEntryId: true, catalogVersion: true, verificationOrigin: true, snapshotJson: true, createdAt: true } as const;
function present<T extends { id: string; createdAt: Date; provenance?: { catalogEntryId: string; catalogVersion: number; verificationOrigin: string; snapshotJson: string; createdAt: Date }[] }>(asset: T) {
  return {
    ...asset,
    createdAt: asset.createdAt.toISOString(),
    url: assetUrl(asset.id),
    provenance: asset.provenance?.map((row): ImageAssetProvenanceSummary => ({
      catalogEntryId: row.catalogEntryId,
      catalogVersion: row.catalogVersion,
      verificationOrigin: provenanceVerificationOrigin(row.verificationOrigin, row.snapshotJson),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function failure(error: unknown) {
  if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof AssetInputError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Image library request failed", error);
  return NextResponse.json({ error: "Unable to update the image library. Please try again." }, { status: 500 });
}
async function getHandler(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const worldId = params.get("worldId");
    if (!worldId) throw new AssetInputError("A world is required.");
    if (!await prisma.world.findUnique({ where: { id: worldId }, select: { id: true } })) throw new AssetInputError("World not found.", 404);
    const query = (params.get("q") || "").slice(0, 200);
    const rawSource = params.get("source") || "all";
    if (!ASSET_SOURCE_FILTERS.includes(rawSource as AssetSourceFilter)) throw new AssetInputError("Choose a supported image source.");
    const source = rawSource as AssetSourceFilter;
    const cursor = params.get("cursor");
    if (cursor && !isAssetId(cursor)) throw new AssetInputError("Invalid image cursor.");
    const search = query ? { OR: [{ title: { contains: query } }, { alt: { contains: query } }, { originalName: { contains: query } }] } : {};
    const assets = await prisma.imageAsset.findMany({
      where: { AND: [{ worldId }, ...(params.get("includeArchived") !== "true" ? [{ archived: false }] : []), assetSourceWhere(source), search] },
      include: { provenance: { select: provenanceSelect, orderBy: { createdAt: "asc" } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 41,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return NextResponse.json({ assets: assets.slice(0, 40).map(present), nextCursor: assets.length > 40 ? assets[39].id : null });
  } catch (error) { return failure(error); }
}
async function postHandler(_request: Request, _context: unknown, authorized: { formData?: FormData }) {
  let fileId: string | null = null;
  try {
    const form = authorized.formData;
    if (!form) throw new AssetInputError("Choose an image to upload.");
    const worldId = form.get("worldId"), file = form.get("file");
    const title = form.get("title"), alt = form.get("alt") || "";
    if (typeof worldId !== "string" || !worldId) throw new AssetInputError("A world is required.");
    if (!await prisma.world.findUnique({ where: { id: worldId }, select: { id: true } })) throw new AssetInputError("World not found.", 404);
    if (!(file instanceof File) || !IMAGE_ACCEPT.split(",").includes(file.type)) throw new AssetInputError("Choose a PNG, JPEG or WebP image.");
    if (typeof alt !== "string" || alt.length > 1000 || (title !== null && (typeof title !== "string" || title.length > 200))) throw new AssetInputError("Use a title up to 200 characters and alternative text up to 1000 characters.");
    const image = await normalizeImage(Buffer.from(await file.arrayBuffer()));
    const existing = await prisma.imageAsset.findUnique({ where: { worldId_sha256: { worldId, sha256: image.sha256 } }, include: { provenance: { select: provenanceSelect, orderBy: { createdAt: "asc" } } } });
    if (existing) {
      const restored = existing.archived ? await prisma.imageAsset.update({ where: { id: existing.id }, data: { archived: false }, include: { provenance: { select: provenanceSelect, orderBy: { createdAt: "asc" } } } }) : existing;
      return NextResponse.json({ ...present(restored), reused: true });
    }
    const id = randomUUID();
    await writeAsset(id, image.data); fileId = id;
    const originalName = file.name.split(/[\\/]/).pop()!.slice(0, 200) || "image";
    try {
      const asset = await prisma.imageAsset.create({ data: { id, worldId, title: typeof title === "string" && title.trim() ? title.trim() : originalName, alt: alt.trim(), originalName, width: image.width, height: image.height, byteSize: image.data.length, sha256: image.sha256 } });
      fileId = null;
      return NextResponse.json(present(asset), { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await removeAssetFile(id); fileId = null;
        const asset = await prisma.imageAsset.update({ where: { worldId_sha256: { worldId, sha256: image.sha256 } }, data: { archived: false }, include: { provenance: { select: provenanceSelect, orderBy: { createdAt: "asc" } } } });
        return NextResponse.json({ ...present(asset), reused: true });
      }
      throw error;
    }
  } catch (error) { if (fileId) await removeAssetFile(fileId); return failure(error); }
}
async function patchHandler(request: Request) {
  try {
    const body = await request.json().catch(() => { throw new AssetInputError("Invalid JSON."); });
    if (!body || typeof body.worldId !== "string" || typeof body.id !== "string") throw new AssetInputError("An image and world are required.");
    if (!await prisma.imageAsset.findFirst({ where: { id: body.id, worldId: body.worldId }, select: { id: true } })) throw new AssetInputError("Image not found in this world.", 404);
    if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200)) throw new AssetInputError("A title of up to 200 characters is required.");
    if (body.alt !== undefined && (typeof body.alt !== "string" || body.alt.length > 1000)) throw new AssetInputError("Alternative text must be at most 1000 characters.");
    if (body.archived !== undefined && typeof body.archived !== "boolean") throw new AssetInputError("Invalid visibility choice.");
    const asset = await prisma.imageAsset.update({ where: { id: body.id }, include: { provenance: { select: provenanceSelect, orderBy: { createdAt: "asc" } } }, data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}), ...(body.alt !== undefined ? { alt: body.alt.trim() } : {}), ...(body.archived !== undefined ? { archived: body.archived } : {}),
    } });
    return NextResponse.json(present(asset));
  } catch (error) { return failure(error); }
}

export const GET = withAuthor({ target: "world-query", field: "worldId" }, getHandler);
export const POST = withAuthor({ target: "world-form", field: "worldId", readForm: readImageForm }, postHandler);
export const PATCH = withAuthor({ target: "world-body", field: "worldId" }, patchHandler);
