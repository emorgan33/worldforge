CREATE TABLE "FoundryPreview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "worldId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL,
  "candidatesJson" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoundryPreview_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FoundryPreview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FoundryPreview_worldId_authorId_expiresAt_idx" ON "FoundryPreview"("worldId", "authorId", "expiresAt");

CREATE TABLE "FoundryImportRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "worldId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "previewId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "outcomesJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING', 
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FoundryImportRun_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FoundryImportRun_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FoundryImportRun_worldId_authorId_idempotencyKey_key" ON "FoundryImportRun"("worldId", "authorId", "idempotencyKey");
CREATE INDEX "FoundryImportRun_worldId_authorId_createdAt_idx" ON "FoundryImportRun"("worldId", "authorId", "createdAt");

CREATE TABLE "FoundryProvenance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "blockId" TEXT NOT NULL,
  "worldId" TEXT NOT NULL,
  "namespace" TEXT NOT NULL,
  "sourceIdentity" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "destinationHash" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceSystemVersion" TEXT NOT NULL,
  "foundryVersion" TEXT NOT NULL,
  "sourceDocumentJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FoundryProvenance_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "RpgBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FoundryProvenance_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FoundryProvenance_blockId_key" ON "FoundryProvenance"("blockId");
CREATE UNIQUE INDEX "FoundryProvenance_worldId_namespace_sourceIdentity_key" ON "FoundryProvenance"("worldId", "namespace", "sourceIdentity");
CREATE INDEX "FoundryProvenance_worldId_idx" ON "FoundryProvenance"("worldId");

CREATE TABLE "FoundryImportOutcome" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "blockId" TEXT,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoundryImportOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FoundryImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FoundryImportOutcome_runId_candidateId_key" ON "FoundryImportOutcome"("runId", "candidateId");
CREATE INDEX "FoundryImportOutcome_runId_createdAt_idx" ON "FoundryImportOutcome"("runId", "createdAt");
