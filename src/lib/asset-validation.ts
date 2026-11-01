import { prisma } from "./db";
import { isImageReference } from "./assets";
import type { Prisma } from "@prisma/client";
import { documentReferences, localAssetId, parseArticleDocument } from "./public-content";

type AssetValidationClient = Pick<Prisma.TransactionClient, "imageAsset">;

export class ImageReferenceError extends Error {
  constructor(message: string) { super(message); this.name = "ImageReferenceError"; }
}

export async function validateImageReference(value: unknown, worldId: string, client: AssetValidationClient = prisma) {
  if (!isImageReference(value)) return "Choose a library image or an HTTP/HTTPS image URL.";
  const id = localAssetId(value.trim());
  if (id && !await client.imageAsset.findFirst({ where: { id, worldId }, select: { id: true } })) return "Image not found in this world.";
  return null;
}

export async function assertImageReference(value: unknown, worldId: string, client: AssetValidationClient) {
  const error = await validateImageReference(value, worldId, client);
  if (error) throw new ImageReferenceError(error);
}

export async function assertDocumentImageReferences(contentJson: unknown, contentHtml: unknown, worldId: string, client: AssetValidationClient) {
  let json: string | null = null;
  if (typeof contentJson === "string") json = contentJson;
  else if (contentJson && typeof contentJson === "object") json = JSON.stringify(contentJson);
  const html = typeof contentHtml === "string" ? contentHtml : null;
  const document = parseArticleDocument(json, html);
  for (const src of documentReferences(document, "image", "src")) {
    const id = localAssetId(src);
    if (id && !await client.imageAsset.findFirst({ where: { id, worldId }, select: { id: true } })) {
      throw new ImageReferenceError("Image not found in this world.");
    }
  }
}
