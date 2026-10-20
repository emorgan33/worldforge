CREATE TABLE "AssetCleanupJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AssetCleanupJob_assetId_key" ON "AssetCleanupJob"("assetId");
CREATE INDEX "AssetCleanupJob_createdAt_idx" ON "AssetCleanupJob"("createdAt");
