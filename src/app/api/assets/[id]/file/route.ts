import { resolveActor, requireReadableResource } from "@/lib/access";
import { assetIsPublic } from "@/lib/public-world";
import { prisma } from "@/lib/db";
import { isAssetId } from "@/lib/assets";
import { readAsset } from "@/lib/asset-storage";
const CACHE_ONE_YEAR = "public, max-age=31536000, immutable";
const CACHE_PRIVATE_YEAR = "private, max-age=31536000, immutable";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAssetId(id)) return new Response("Image not found", { status: 404 });
  
  // Use a lightweight existence check — asset content is immutable for a given ID
  const asset = await prisma.imageAsset.findUnique({
    where: { id },
    select: { id: true, worldId: true, archived: true, world: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!asset || asset.world.deletedAt) return new Response("Image not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  
  const actor = await resolveActor();
  const isOwner = actor.userId === asset.world.ownerId;
  const isAnonymousPublicAsset = actor.kind === "ANONYMOUS" && !asset.archived && await assetIsPublic(id, asset.worldId);
  if (!isOwner && !isAnonymousPublicAsset) {
    try {
      await requireReadableResource({ worldId: asset.worldId, kind: "assets", id }, actor);
    } catch {
      return new Response("Image not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }
  
  try {
    const bytes = await readAsset(id);
    // Images are immutable per ID — safe to cache aggressively
    const cacheControl = isAnonymousPublicAsset ? CACHE_ONE_YEAR : CACHE_PRIVATE_YEAR;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": cacheControl,
        "Vary": "Accept-Encoding",
      },
    });
  } catch { return new Response("Image unavailable", { status: 404 }); }
}
