import { prisma } from "@/lib/db";
import { exportWorldV2, exportWorldV3, importWorldV2, worldNeedsV3, type WorldExportV1, type WorldExportV2, type WorldExportV3 } from "@/lib/world-export";
import { decodeWorldTransfer, isWorldTransferShape, toCanonicalWorldTransfer, type DecodedWorldTransfer } from "@/lib/world-transfer-adapters";
import { importWorldV1, type WorldTransferExecutionResult } from "@/lib/world-transfer-v1";
import { exportWorldV1 } from "@/lib/world-transfer-v1-export";

export type WorldTransferImportResult =
  | ({ success: true } & WorldTransferExecutionResult)
  | { success: false; error: string; status: 400 | 500 };

export class WorldTransferExecutionError extends Error {
  constructor(message: string, readonly status: 400) { super(message); }
}

/** Execute a decoded manifest through its version adapter. */
export async function executeWorldTransfer(decoded: DecodedWorldTransfer, ownerId: string): Promise<WorldTransferImportResult> {
  // Constructing the canonical view here ensures common identity and content
  // fields are available independently of the source manifest discriminator.
  const canonical = toCanonicalWorldTransfer(decoded);
  if (decoded.version === 1) {
    if (!canonical.sourceWorld.title || !canonical.sourceWorld.slug) {
      return { success: false, error: "Export file is missing world information", status: 400 };
    }
    if (decoded.bundle.assets?.some(asset => "provenance" in asset)) {
      return { success: false, error: "Format 1 cannot preserve image provenance. Import a format 3 bundle instead.", status: 400 };
    }
    return { success: true, ...await importWorldV1(decoded.bundle, ownerId) };
  }

  const result = await importWorldV2(
    decoded.bundle,
    ownerId,
    async slug => !!(await prisma.world.findUnique({ where: { slug }, select: { id: true } })),
  );
  if (!result.success) return { success: false, error: result.error || "Failed to import world", status: 500 };
  if (!result.worldId) return { success: false, error: "Import completed without a world identifier", status: 500 };
  return { success: true, worldId: result.worldId, warnings: result.warnings, imported: result.imported };
}

/** Decode an untrusted object and execute it, returning a transport-neutral error. */
export async function importWorldTransfer(value: unknown, ownerId: string): Promise<WorldTransferImportResult> {
  if (!isWorldTransferShape(value)) return { success: false, error: "Import file is malformed or exceeds supported section limits", status: 400 };
  const decoded = decodeWorldTransfer(value);
  return decoded ? executeWorldTransfer(decoded, ownerId) : { success: false, error: "Unsupported export format version", status: 400 };
}

export type WorldTransferExportBundle = WorldExportV1 | WorldExportV2 | WorldExportV3;

/** Select and execute the version-specific export adapter after route options are parsed. */
export async function exportWorldTransfer(
  worldId: string,
  version: 1 | 2 | 3,
  ownerId: string,
  options: { includeAssets: boolean; includePrivate: boolean },
): Promise<WorldTransferExportBundle> {
  if (version !== 3 && await worldNeedsV3(worldId)) {
    throw new WorldTransferExecutionError("This world uses image provenance or placement data that legacy exports would silently drop. Export with format=v3 instead.", 400);
  }
  if (version === 1) return exportWorldV1(worldId, ownerId, options.includeAssets, options.includePrivate);
  if (version === 2) return exportWorldV2(worldId);
  return exportWorldV3(worldId);
}
