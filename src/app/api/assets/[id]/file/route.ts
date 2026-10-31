import { resolveActor, requireReadableResource } from "@/lib/access";
import { assetIsPublic } from "@/lib/public-world";
import { prisma } from "@/lib/db";
import { isAssetId } from "@/lib/assets";
import { readAsset } from "@/lib/asset-storage";
const CACHE_ONE_YEAR = "public, no-store";
const CACHE_PRIVATE_YEAR = "private, no-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAssetId(id)) return new Response("Image not found", { status: 404 });
  
  // Use a lightweight existence check — asset content is immutable for a given ID
  const asset = await prisma.imageAsset.findUnique({
    where: { id },
    select: { id: true, worldId: true, displayRestricted: true, world: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!asset || asset.world.deletedAt) return new Response("Image not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const actor = await resolveActor();
  // Preview actors carry the selected member's userId, but their capability is
  // scoped to previewWorldId. Never let that impersonated identity use the
  // cross-world owner shortcut below.
  const isOwner = actor.kind !== "PREVIEW" && actor.userId === asset.world.ownerId;
  // An operator advisory removes affected copies from reader display even when
  // the placement is otherwise public; owners retain access for review.
  if (asset.displayRestricted && !isOwner) return new Response("Image not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  // Archiving hides an asset from the picker; it does not invalidate a
  // placement that was already published. The placement query is the access
  // decision, and unplaced archived assets remain private.
  const isAnonymousPublicAsset = actor.kind === "ANONYMOUS" && !asset.displayRestricted && await assetIsPublic(id, asset.worldId);
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
