-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worldId" TEXT NOT NULL,
    "resourceKind" TEXT,
    "resourceId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "parentEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessAuditEvent_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AccessAuditEvent" ("action", "actorId", "afterJson", "beforeJson", "createdAt", "id", "parentEventId", "resourceId", "resourceKind", "worldId") SELECT "action", "actorId", "afterJson", "beforeJson", "createdAt", "id", "parentEventId", "resourceId", "resourceKind", "worldId" FROM "AccessAuditEvent";
DROP TABLE "AccessAuditEvent";
ALTER TABLE "new_AccessAuditEvent" RENAME TO "AccessAuditEvent";
CREATE INDEX "AccessAuditEvent_worldId_createdAt_idx" ON "AccessAuditEvent"("worldId", "createdAt");
CREATE INDEX "AccessAuditEvent_resourceKind_resourceId_createdAt_idx" ON "AccessAuditEvent"("resourceKind", "resourceId", "createdAt");
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
    "publicationStatus" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "articleVersionAtSave" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ArticleRevision" ("articleId", "articleVersionAtSave", "contentHtml", "contentJson", "createdAt", "excerpt", "id", "metadata", "publicationStatus", "savedAt", "slug", "state", "tags", "title", "userId", "visibility") SELECT "articleId", "articleVersionAtSave", "contentHtml", "contentJson", "createdAt", "excerpt", "id", "metadata", "publicationStatus", "savedAt", "slug", "state", "tags", "title", "userId", "visibility" FROM "ArticleRevision";
DROP TABLE "ArticleRevision";
ALTER TABLE "new_ArticleRevision" RENAME TO "ArticleRevision";
CREATE INDEX "ArticleRevision_articleId_idx" ON "ArticleRevision"("articleId");
CREATE INDEX "ArticleRevision_articleId_savedAt_idx" ON "ArticleRevision"("articleId", "savedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
