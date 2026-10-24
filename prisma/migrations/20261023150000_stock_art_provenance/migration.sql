-- Add persisted acquisition source to world images. Existing uploads default to
-- UPLOADED; selecting catalog artwork writes STOCK and imports preserve their
-- declaration separately from verification.
ALTER TABLE "ImageAsset" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'UPLOADED';

-- Reviewed or imported provenance is append-only from ordinary asset edits.
CREATE TABLE "ImageAssetProvenance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "catalogEntryId" TEXT NOT NULL,
    "catalogVersion" INTEGER NOT NULL,
    "manifestDigest" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "verificationOrigin" TEXT NOT NULL DEFAULT 'BUNDLED_REVIEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageAssetProvenance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ImageAssetProvenance_assetId_catalogEntryId_catalogVersion_manifestDigest_key" ON "ImageAssetProvenance"("assetId", "catalogEntryId", "catalogVersion", "manifestDigest");
CREATE INDEX "ImageAssetProvenance_catalogEntryId_catalogVersion_idx" ON "ImageAssetProvenance"("catalogEntryId", "catalogVersion");
CREATE INDEX "ImageAssetProvenance_manifestDigest_idx" ON "ImageAssetProvenance"("manifestDigest");
CREATE INDEX "ImageAsset_worldId_source_idx" ON "ImageAsset"("worldId", "source");
