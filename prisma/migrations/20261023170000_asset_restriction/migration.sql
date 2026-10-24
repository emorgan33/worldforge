-- Operator-applied display restriction for copied stock/imported artwork.
-- Kept separate from `archived` so ordinary library hiding never clears it.
ALTER TABLE "ImageAsset" ADD COLUMN "displayRestricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImageAsset" ADD COLUMN "restrictionReason" TEXT;
ALTER TABLE "ImageAsset" ADD COLUMN "restrictionDate" DATETIME;
