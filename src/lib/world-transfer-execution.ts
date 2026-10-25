import { prisma } from "@/lib/db";
import { exportWorldV2, exportWorldV3, exportWorldV4, importWorldV2, worldNeedsV3, type WorldExportV1, type WorldExportV2, type WorldExportV3, type WorldExportV4 } from "@/lib/world-export";
import { decodeWorldTransfer, isWorldTransferShape, toCanonicalWorldTransfer, worldTransferLimitError, type DecodedWorldTransfer } from "@/lib/world-transfer-adapters";
import { importWorldV1, type WorldTransferExecutionResult } from "@/lib/world-transfer-v1";
import { exportWorldV1 } from "@/lib/world-transfer-v1-export";
import { createHash } from "node:crypto";
import { removeAssetFile } from "@/lib/asset-storage";

export type WorldTransferImportResult =
  | ({ success: true } & WorldTransferExecutionResult)
  | { success: false; error: string; status: 400 | 500 };

export class WorldTransferExecutionError extends Error {
  constructor(message: string, readonly status: 400) { super(message); }
}

/** Execute a decoded manifest through its version adapter. */
function stableImportId(requestId: string, part: string) {
  const hex = createHash("sha256").update(`${requestId}:${part}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function executeWorldTransfer(decoded: DecodedWorldTransfer, ownerId: string, identity?: { requestId: string; recover: boolean }): Promise<WorldTransferImportResult> {
  // Constructing the canonical view here ensures common identity and content
  // fields are available independently of the source manifest discriminator.
  const canonical = toCanonicalWorldTransfer(decoded);
  const importIdentity = identity ? { worldId: stableImportId(identity.requestId, "world"), assetId: (sourceId: string) => stableImportId(identity.requestId, `asset:${sourceId}`) } : undefined;
  if (identity?.recover && importIdentity) {
    await prisma.world.deleteMany({ where: { id: importIdentity.worldId, ownerId } });
    for (const asset of canonical.assets ?? []) await removeAssetFile(importIdentity.assetId(asset.id));
    await prisma.assetCleanupJob.deleteMany({ where: { assetId: { in: (canonical.assets ?? []).map(asset => importIdentity.assetId(asset.id)) } } });
  }
  if (decoded.version === 1) {
    if (!canonical.sourceWorld.title || !canonical.sourceWorld.slug) {
      return { success: false, error: "Export file is missing world information", status: 400 };
    }
    if (decoded.bundle.assets?.some(asset => "provenance" in asset)) {
      return { success: false, error: "Format 1 cannot preserve image provenance. Import a format 4 bundle instead.", status: 400 };
    }
    return { success: true, ...await importWorldV1(decoded.bundle, ownerId, importIdentity) };
  }

  const result = await importWorldV2(
    decoded.bundle,
    ownerId,
    async slug => !!(await prisma.world.findUnique({ where: { slug }, select: { id: true } })),
    importIdentity,
  );
  if (!result.success) return { success: false, error: result.error || "Failed to import world", status: 500 };
  if (!result.worldId) return { success: false, error: "Import completed without a world identifier", status: 500 };
  return { success: true, worldId: result.worldId, warnings: result.warnings, imported: result.imported };
}

/** Decode an untrusted object and execute it, returning a transport-neutral error. */
export async function importWorldTransfer(value: unknown, ownerId: string, identity?: { requestId: string; recover: boolean }): Promise<WorldTransferImportResult> {
  if (!isWorldTransferShape(value)) return { success: false, error: "Import file is malformed or exceeds supported section limits", status: 400 };
  const decoded = decodeWorldTransfer(value);
  return decoded ? executeWorldTransfer(decoded, ownerId, identity) : { success: false, error: "Unsupported export format version", status: 400 };
}

export type WorldTransferExportBundle = WorldExportV1 | WorldExportV2 | WorldExportV3 | WorldExportV4;

/** Select and execute the version-specific export adapter after route options are parsed. */
export async function exportWorldTransfer(
  worldId: string,
  version: 1 | 2 | 3 | 4,
  ownerId: string,
  options: { includeAssets: boolean; includePrivate: boolean },
): Promise<WorldTransferExportBundle> {
  if (version < 3 && await worldNeedsV3(worldId)) {
    throw new WorldTransferExecutionError("This world uses image provenance or placement data that legacy exports would silently drop. Export with format=v4 instead.", 400);
  }
  const bundle = version === 1
    ? await exportWorldV1(worldId, ownerId, options.includeAssets, options.includePrivate)
    : version === 2 ? await exportWorldV2(worldId)
      : version === 3 ? await exportWorldV3(worldId) : await exportWorldV4(worldId);
  if (Buffer.byteLength(JSON.stringify(bundle)) > 60 * 1024 * 1024) {
    throw new WorldTransferExecutionError("Export bundle exceeds the 60 MB import limit; use the SQLite-plus-assets backup workflow.", 400);
  }
  const limitError = worldTransferLimitError(bundle);
  if (limitError) {
    throw new WorldTransferExecutionError(`This export cannot be imported: ${limitError}. Reduce this section or use the SQLite-plus-assets backup workflow.`, 400);
  }
  return bundle;
}
