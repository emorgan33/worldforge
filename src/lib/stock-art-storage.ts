import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assetUrl, type ImageAssetItem, type ImageAssetProvenanceSummary } from "./assets";
import { removeAssetFile, writeAsset } from "./asset-storage";
import { prisma } from "./db";
import { hasApprovedStockReview, provenanceVerificationOrigin } from "./stock-provenance";
import {
  findStockArtEntry,
  isStockArtSelectable,
  loadStockArtCatalog,
  MAX_STOCK_ART_SNAPSHOT_BYTES,
  readStockArtImage,
  stockArtDirectory,
  StockArtError,
  type StockArtManifestEntry,
} from "./stock-art";

interface ProvenanceRow {
  catalogEntryId: string;
  catalogVersion: number;
  verificationOrigin: string;
  snapshotJson: string;
  createdAt: Date;
}

interface AssetRow {
  id: string;
  worldId: string;
  title: string;
  originalName: string;
  alt: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  source: string;
  archived: boolean;
  createdAt: Date;
  provenance?: ProvenanceRow[];
}

export interface MaterializedStockArt {
  asset: ImageAssetItem;
  reused: boolean;
}

function present(asset: AssetRow): ImageAssetItem {
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

async function appendProvenance(assetId: string, entry: StockArtManifestEntry, manifestDigest: string, snapshotJson: string) {
  await prisma.imageAssetProvenance.upsert({
    where: {
      assetId_catalogEntryId_catalogVersion_manifestDigest: {
        assetId,
        catalogEntryId: entry.id,
        catalogVersion: entry.version,
        manifestDigest,
      },
    },
    create: {
      assetId,
      catalogEntryId: entry.id,
      catalogVersion: entry.version,
      manifestDigest,
      snapshotJson,
      verificationOrigin: hasApprovedStockReview(entry) ? "BUNDLED_REVIEW" : "PENDING_REVIEW",
    },
    update: {},
  });
}

async function removeOrQueue(assetId: string, error: unknown) {
  try {
    await removeAssetFile(assetId);
  } catch (removalError) {
    const reason = removalError instanceof Error ? removalError.message : String(removalError);
    await prisma.assetCleanupJob.upsert({
      where: { assetId },
      create: { assetId, lastError: reason },
      update: { attempts: { increment: 1 }, lastError: reason },
    }).catch(() => {
      console.error("Unable to queue stock-art cleanup", error, removalError);
    });
  }
}

async function existingAsset(worldId: string, sha256: string) {
  return prisma.imageAsset.findUnique({
    where: { worldId_sha256: { worldId, sha256 } },
    include: {
      provenance: {
        select: { catalogEntryId: true, catalogVersion: true, verificationOrigin: true, snapshotJson: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function materializeStockArt(worldId: string, entryId: string, version: number, options: { root?: string } = {}): Promise<MaterializedStockArt> {
  const root = options.root ? options.root : stockArtDirectory();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entryId) || !Number.isSafeInteger(version) || version < 1) {
    throw new StockArtError("Choose a valid stock-art entry.");
  }
  const world = await prisma.world.findFirst({ where: { id: worldId, deletedAt: null }, select: { id: true } });
  if (!world) throw new StockArtError("World not found.", 404);

  const { catalog, manifestDigest } = await loadStockArtCatalog(root);
  if (!manifestDigest) throw new StockArtError("The stock-art catalog manifest is unavailable.", 503);
  const entry = findStockArtEntry(catalog, entryId, version);
  if (!entry) throw new StockArtError("This artwork is not in the installed catalog.", 404);
  if (!isStockArtSelectable(entry)) throw new StockArtError("This artwork is no longer available for new selections.", 409);

  const snapshotJson = JSON.stringify(entry);
  if (Buffer.byteLength(snapshotJson) > MAX_STOCK_ART_SNAPSHOT_BYTES) throw new StockArtError("The artwork's provenance record is too large.", 500);
  const bytes = await readStockArtImage(root, entry, "image");
  const digest = entry.derivatives.imageSha256;
  if (bytes.length !== entry.derivatives.byteSize) throw new StockArtError("The bundled artwork does not match its reviewed metadata.", 503);

  const existing = await existingAsset(worldId, digest);
  if (existing) {
    if (existing.archived) await prisma.imageAsset.update({ where: { id: existing.id }, data: { archived: false } });
    await appendProvenance(existing.id, entry, manifestDigest, snapshotJson);
    const refreshed = await existingAsset(worldId, digest);
    return { asset: present((refreshed || { ...existing, archived: false }) as AssetRow), reused: true };
  }

  const id = randomUUID();
  await writeAsset(id, bytes);
  try {
    const asset = await prisma.$transaction(async transaction => {
      const created = await transaction.imageAsset.create({
        data: {
          id,
          worldId,
          title: entry.title,
          originalName: entry.source.originalFilename,
          alt: entry.defaultAlt,
          width: entry.derivatives.width,
          height: entry.derivatives.height,
          byteSize: bytes.length,
          sha256: digest,
          source: "STOCK",
        },
      });
      await transaction.imageAssetProvenance.create({
        data: {
          assetId: id,
          catalogEntryId: entry.id,
          catalogVersion: entry.version,
          manifestDigest,
          snapshotJson,
          verificationOrigin: hasApprovedStockReview(entry) ? "BUNDLED_REVIEW" : "PENDING_REVIEW",
        },
      });
      return created;
    });
    return {
      asset: present({ ...asset, provenance: [{ catalogEntryId: entry.id, catalogVersion: entry.version, verificationOrigin: hasApprovedStockReview(entry) ? "BUNDLED_REVIEW" : "PENDING_REVIEW", snapshotJson, createdAt: new Date() }] } as AssetRow),
      reused: false,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await removeOrQueue(id, error);
      const winner = await existingAsset(worldId, digest);
      if (winner) {
        if (winner.archived) await prisma.imageAsset.update({ where: { id: winner.id }, data: { archived: false } });
        await appendProvenance(winner.id, entry, manifestDigest, snapshotJson);
        const refreshed = await existingAsset(worldId, digest);
        return { asset: present((refreshed || { ...winner, archived: false }) as AssetRow), reused: true };
      }
    }
    await removeOrQueue(id, error);
    throw error;
  }
}
