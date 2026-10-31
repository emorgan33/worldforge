-- Installation administration foundation (P1)
-- Adds account lifecycle fields, session management IDs, installation audit,
-- singleton state, and converts destructive user foreign keys to RESTRICT.

-- Account lifecycle and pagination fields on User.
ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSignInAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "accountVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "User_role_disabledAt_createdAt_idx" ON "User"("role", "disabledAt", "createdAt");
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt", "id");

-- Singleton that serializes installation lifecycle decisions.
CREATE TABLE "InstallationAdminState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);
INSERT OR IGNORE INTO "InstallationAdminState" ("id", "version", "updatedAt") VALUES (1, 0, CURRENT_TIMESTAMP);

-- Append-only installation audit log with scalar ID snapshots.
CREATE TABLE "InstallationAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorIdSnapshot" TEXT,
    "targetIdSnapshot" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasonCode" TEXT,
    "detailsJson" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "InstallationAuditEvent_createdAt_id_idx" ON "InstallationAuditEvent"("createdAt", "id");
CREATE INDEX "InstallationAuditEvent_targetIdSnapshot_createdAt_idx" ON "InstallationAuditEvent"("targetIdSnapshot", "createdAt");
CREATE INDEX "InstallationAuditEvent_action_createdAt_idx" ON "InstallationAuditEvent"("action", "createdAt");

-- Add an opaque session management ID and backfill existing sessions.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AuthSession" ("id", "createdAt", "expiresAt", "tokenHash", "userId")
SELECT lower(hex(randomblob(16))), "createdAt", "expiresAt", "tokenHash", "userId" FROM "AuthSession";
DROP TABLE "AuthSession";
ALTER TABLE "new_AuthSession" RENAME TO "AuthSession";
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- Owned worlds must be deliberately purged before account deletion.
CREATE TABLE "new_World" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "genre" TEXT NOT NULL DEFAULT 'Fantasy',
    "system" TEXT NOT NULL DEFAULT 'DND_5E',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "coverImage" TEXT,
    "coverImageAlt" TEXT,
    "appearance" TEXT,
    "bannerImage" TEXT,
    "bannerImageAlt" TEXT,
    "ownerId" TEXT NOT NULL,
    "creationRequestId" TEXT,
    "creationPayloadHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "World_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_World" ("appearance", "bannerImage", "bannerImageAlt", "coverImage", "coverImageAlt", "createdAt", "creationPayloadHash", "creationRequestId", "deletedAt", "description", "genre", "id", "isPublic", "ownerId", "slug", "system", "title", "updatedAt")
SELECT "appearance", "bannerImage", "bannerImageAlt", "coverImage", "coverImageAlt", "createdAt", "creationPayloadHash", "creationRequestId", "deletedAt", "description", "genre", "id", "isPublic", "ownerId", "slug", "system", "title", "updatedAt" FROM "World";
DROP TABLE "World";
ALTER TABLE "new_World" RENAME TO "World";
CREATE UNIQUE INDEX "World_slug_key" ON "World"("slug");
CREATE UNIQUE INDEX "World_ownerId_creationRequestId_key" ON "World"("ownerId", "creationRequestId");

-- Durable revision history must survive until its owning content is purged.
CREATE TABLE "new_ArticleRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "contentHtml" TEXT,
    "contentJson" TEXT,
    "metadata" TEXT,
    "tags" TEXT,
    "coverImage" TEXT,
    "coverImageAlt" TEXT,
    "portraitImage" TEXT,
    "portraitImageAlt" TEXT,
    "publicationStatus" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "articleVersionAtSave" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ArticleRevision" ("articleId", "articleVersionAtSave", "contentHtml", "contentJson", "coverImage", "coverImageAlt", "createdAt", "excerpt", "id", "metadata", "portraitImage", "portraitImageAlt", "publicationStatus", "savedAt", "slug", "state", "tags", "title", "userId", "visibility")
SELECT "articleId", "articleVersionAtSave", "contentHtml", "contentJson", "coverImage", "coverImageAlt", "createdAt", "excerpt", "id", "metadata", "portraitImage", "portraitImageAlt", "publicationStatus", "savedAt", "slug", "state", "tags", "title", "userId", "visibility" FROM "ArticleRevision";
DROP TABLE "ArticleRevision";
ALTER TABLE "new_ArticleRevision" RENAME TO "ArticleRevision";
CREATE INDEX "ArticleRevision_articleId_idx" ON "ArticleRevision"("articleId");
CREATE INDEX "ArticleRevision_articleId_savedAt_idx" ON "ArticleRevision"("articleId", "savedAt");

-- Durable Foundry import previews/runs restrict owner deletion.
CREATE TABLE "new_FoundryPreview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worldId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "candidatesJson" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FoundryPreview_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FoundryPreview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FoundryPreview" ("authorId", "candidatesJson", "createdAt", "expiresAt", "id", "metadataJson", "worldId")
SELECT "authorId", "candidatesJson", "createdAt", "expiresAt", "id", "metadataJson", "worldId" FROM "FoundryPreview";
DROP TABLE "FoundryPreview";
ALTER TABLE "new_FoundryPreview" RENAME TO "FoundryPreview";
CREATE INDEX "FoundryPreview_worldId_authorId_expiresAt_idx" ON "FoundryPreview"("worldId", "authorId", "expiresAt");

CREATE TABLE "new_FoundryImportRun" (
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
    CONSTRAINT "FoundryImportRun_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FoundryImportRun" ("authorId", "createdAt", "id", "idempotencyKey", "outcomesJson", "previewId", "requestHash", "status", "updatedAt", "worldId")
SELECT "authorId", "createdAt", "id", "idempotencyKey", "outcomesJson", "previewId", "requestHash", "status", "updatedAt", "worldId" FROM "FoundryImportRun";
DROP TABLE "FoundryImportRun";
ALTER TABLE "new_FoundryImportRun" RENAME TO "FoundryImportRun";
CREATE INDEX "FoundryImportRun_worldId_authorId_createdAt_idx" ON "FoundryImportRun"("worldId", "authorId", "createdAt");
CREATE UNIQUE INDEX "FoundryImportRun_worldId_authorId_idempotencyKey_key" ON "FoundryImportRun"("worldId", "authorId", "idempotencyKey");

-- World transfer requests are durable until explicitly resolved.
CREATE TABLE "new_WorldTransferImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultJson" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldTransferImport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorldTransferImport" ("createdAt", "error", "id", "ownerId", "payloadHash", "payloadJson", "requestKey", "resultJson", "status", "updatedAt")
SELECT "createdAt", "error", "id", "ownerId", "payloadHash", "payloadJson", "requestKey", "resultJson", "status", "updatedAt" FROM "WorldTransferImport";
DROP TABLE "WorldTransferImport";
ALTER TABLE "new_WorldTransferImport" RENAME TO "WorldTransferImport";
CREATE INDEX "WorldTransferImport_ownerId_status_updatedAt_idx" ON "WorldTransferImport"("ownerId", "status", "updatedAt");
CREATE UNIQUE INDEX "WorldTransferImport_ownerId_requestKey_key" ON "WorldTransferImport"("ownerId", "requestKey");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
