import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { MAX_IMAGE_BYTES, isAssetId } from "./assets";

export class AssetInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
// Runtime uploads live in a persistent volume and must not enter the deployment bundle.
export const assetDirectory = () => path.resolve(/* turbopackIgnore: true */ process.env.WORLDFORGE_ASSET_DIR || path.join(process.cwd(), "data/assets"));
function assetPath(id: string) {
  if (!isAssetId(id)) throw new AssetInputError("Invalid image ID.");
  return path.join(assetDirectory(), `${id}.webp`);
}
export async function normalizeImage(input: Buffer) {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new AssetInputError("Choose an image no larger than 10 MB.", 413);
  try {
    const decoder = sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error();
    const { data, info } = await decoder.rotate().webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new AssetInputError("The processed image exceeds 10 MB. Choose a smaller image.", 413);
    return { data, width: info.width, height: info.height, sha256: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof AssetInputError) throw error;
    throw new AssetInputError("Choose a valid, non-animated PNG, JPEG or WebP image of at most 40 megapixels.");
  }
}
export async function writeAsset(id: string, bytes: Buffer) { await mkdir(assetDirectory(), { recursive: true }); await writeFile(assetPath(id), bytes, { flag: "wx", mode: 0o600 }); }
export async function readAsset(id: string) { return readFile(assetPath(id)); }
export async function removeAssetFile(id: string) { await unlink(assetPath(id)).catch(error => { if (error.code !== "ENOENT") throw error; }); }

/** Bound multipart bytes before the platform parser buffers the request. */
export async function readImageForm(request: Request) {
  const limit = MAX_IMAGE_BYTES + 64 * 1024;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new AssetInputError("Expected an image upload form.");
  if (Number(request.headers.get("content-length")) > limit) throw new AssetInputError("Upload exceeds 10 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AssetInputError("Choose a file to upload.");
  const chunks: Buffer[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AssetInputError("Upload exceeds 10 MB.", 413); }
      chunks.push(Buffer.from(next.value));
    }
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch (error) {
    if (error instanceof AssetInputError) throw error;
    throw new AssetInputError("Unable to read the image upload.");
  } finally { reader.releaseLock(); }
}
