import type { Prisma } from "@prisma/client";
import type { StockVerificationOrigin } from "./stock-provenance";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const ASSET_SOURCE_FILTERS = ["all", "uploaded", "stock", "imported"] as const;
export type AssetSourceFilter = (typeof ASSET_SOURCE_FILTERS)[number];
export type ImageAssetSource = "UPLOADED" | "STOCK" | "IMPORTED";
export interface ImageAssetProvenanceSummary {
  catalogEntryId: string; catalogVersion: number; verificationOrigin: StockVerificationOrigin;
  createdAt: string;
}
export interface ImageAssetItem {
  id: string; worldId: string; title: string; originalName: string; alt: string;
  mimeType: string; byteSize: number; width: number; height: number;
  source?: ImageAssetSource | string; provenance?: ImageAssetProvenanceSummary[];
  archived: boolean; url: string; createdAt: string;
}
export function assetUrl(id: string) { return `/api/assets/${id}/file`; }
export function assetSourceWhere(source: AssetSourceFilter): Prisma.ImageAssetWhereInput {
  if (source === "uploaded") return { source: "UPLOADED" };
  if (source === "imported") return { OR: [{ source: "IMPORTED" }, { provenance: { some: { verificationOrigin: "IMPORTED_DECLARATION" } } }] };
  if (source === "stock") return { OR: [{ source: "STOCK" }, { provenance: { some: { verificationOrigin: { in: ["BUNDLED_REVIEW", "PENDING_REVIEW"] } } } }] };
  return {};
}
export function isAssetId(id: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id); }
export function imageAssetId(value: string) {
  const match = /^\/api\/assets\/([^/]+)\/file$/.exec(value);
  return match && isAssetId(match[1]) ? match[1] : null;
}
export function isImageReference(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (!value.trim() || imageAssetId(value.trim())) return true;
  try { return ["http:", "https:"].includes(new URL(value.trim()).protocol); } catch { return false; }
}
