import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { ASSET_SOURCE_FILTERS, assetSourceWhere, imageAssetId, isImageReference, MAX_IMAGE_BYTES } from "../src/lib/assets";
import { normalizeImage, readImageForm, AssetInputError } from "../src/lib/asset-storage";
import { localAssetId } from "../src/lib/public-content";
const id = "b96e99c9-73a0-4725-a75d-3d22d70a2baa";
test("image references accept library IDs and HTTP URLs, excluding paths and executable schemes", () => {
  assert.equal(imageAssetId(`/api/assets/${id}/file`), id);
  for (const value of ["", `/api/assets/${id}/file`, "https://example.com/art.png", "http://localhost:3033/art.png"]) assert(isImageReference(value));
  for (const value of ["/etc/passwd", "/api/assets/../file", `/api/assets/${id}/file?path=bad`, "javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///tmp/image"]) assert(!isImageReference(value));
});
test("local asset references normalize surrounding src whitespace before extracting IDs", () => {
  assert.equal(localAssetId(` /api/assets/${id}/file `), id);
  assert.equal(localAssetId(` https://example.invalid/api/assets/${id}/file `), id);
});
test("image normalization decodes pixels, strips metadata and preserves transparency", async () => {
  const input = await sharp({ create: { width: 4, height: 3, channels: 4, background: { r: 80, g: 30, b: 120, alpha: .5 } } }).png().withMetadata().toBuffer();
  const normalized = await normalizeImage(input);
  const metadata = await sharp(normalized.data).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 4); assert.equal(metadata.height, 3); assert.equal(metadata.hasAlpha, true); assert.equal(metadata.exif, undefined);
  assert.equal((await normalizeImage(input)).sha256, normalized.sha256);
});
test("image normalization rejects corrupt, SVG and oversized input", async () => {
  for (const input of [Buffer.from("not a real PNG"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), Buffer.alloc(MAX_IMAGE_BYTES + 1)]) await assert.rejects(normalizeImage(input), AssetInputError);
});
test("multipart parsing enforces the byte limit even without Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 65 * 1024)); controller.close(); } });
  const request = new Request("http://localhost/api/assets", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readImageForm(request), (error: unknown) => error instanceof AssetInputError && error.status === 413);
});

test("asset source filters are validated and applied before pagination", () => {
  assert.deepEqual([...ASSET_SOURCE_FILTERS], ["all", "uploaded", "stock", "imported"]);
  assert.deepEqual(assetSourceWhere("all"), {});
  assert.deepEqual(assetSourceWhere("uploaded"), { source: "UPLOADED" });
  assert.deepEqual(assetSourceWhere("stock"), { OR: [{ source: "STOCK" }, { provenance: { some: { verificationOrigin: { in: ["BUNDLED_REVIEW", "PENDING_REVIEW"] } } } }] });
  assert.deepEqual(assetSourceWhere("imported"), { OR: [{ source: "IMPORTED" }, { provenance: { some: { verificationOrigin: "IMPORTED_DECLARATION" } } }] });
});
