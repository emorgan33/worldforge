import { prisma } from "./db";
import { imageAssetId, isImageReference } from "./assets";

export async function validateImageReference(value: unknown, worldId: string) {
  if (!isImageReference(value)) return "Choose a library image or an HTTP/HTTPS image URL.";
  const id = imageAssetId(value.trim());
  if (id && !await prisma.imageAsset.findFirst({ where: { id, worldId }, select: { id: true } })) return "Image not found in this world.";
  return null;
}
