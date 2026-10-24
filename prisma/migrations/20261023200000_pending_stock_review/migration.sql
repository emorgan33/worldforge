-- Review is explicit. Old snapshots without approval must not imply a sign-off.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ImageAssetProvenance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "catalogEntryId" TEXT NOT NULL,
    "catalogVersion" INTEGER NOT NULL,
    "manifestDigest" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "verificationOrigin" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageAssetProvenance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ImageAssetProvenance" ("id", "assetId", "catalogEntryId", "catalogVersion", "manifestDigest", "snapshotJson", "verificationOrigin", "createdAt")
SELECT "id", "assetId", "catalogEntryId", "catalogVersion", "manifestDigest", "snapshotJson",
    CASE WHEN "verificationOrigin" = 'BUNDLED_REVIEW' THEN
        CASE WHEN json_valid("snapshotJson") THEN
            CASE WHEN json_extract("snapshotJson", '$.rights.reviewStatus') = 'approved'
                AND json_type("snapshotJson", '$.rights.evidence.reviewer') = 'text'
                AND json_type("snapshotJson", '$.rights.evidence.reviewedAt') = 'text'
                AND length(trim(json_extract("snapshotJson", '$.rights.evidence.reviewer'))) > 0
                AND lower(json_extract("snapshotJson", '$.rights.evidence.reviewer')) NOT LIKE '%pending%'
                AND lower(json_extract("snapshotJson", '$.rights.evidence.reviewer')) NOT LIKE '%unreviewed%'
                AND lower(json_extract("snapshotJson", '$.rights.evidence.reviewer')) NOT LIKE '%unknown%'
                AND lower(json_extract("snapshotJson", '$.rights.evidence.reviewer')) NOT LIKE '%tbd%'
                AND julianday(json_extract("snapshotJson", '$.rights.evidence.reviewedAt')) IS NOT NULL
            THEN 'BUNDLED_REVIEW' ELSE 'PENDING_REVIEW' END
        ELSE 'PENDING_REVIEW' END
    ELSE "verificationOrigin" END,
    "createdAt"
FROM "ImageAssetProvenance";

DROP TABLE "ImageAssetProvenance";
ALTER TABLE "new_ImageAssetProvenance" RENAME TO "ImageAssetProvenance";
CREATE UNIQUE INDEX "ImageAssetProvenance_assetId_catalogEntryId_catalogVersion_manifestDigest_key" ON "ImageAssetProvenance"("assetId", "catalogEntryId", "catalogVersion", "manifestDigest");
CREATE INDEX "ImageAssetProvenance_catalogEntryId_catalogVersion_idx" ON "ImageAssetProvenance"("catalogEntryId", "catalogVersion");
CREATE INDEX "ImageAssetProvenance_manifestDigest_idx" ON "ImageAssetProvenance"("manifestDigest");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
