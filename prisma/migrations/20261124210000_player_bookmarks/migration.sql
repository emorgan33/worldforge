-- Private player bookmarks for campaign articles and published maps.
CREATE TABLE "PlayerBookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "resourceKind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerBookmark_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlayerBookmark_userId_resourceKind_resourceId_key" ON "PlayerBookmark"("userId", "resourceKind", "resourceId");
CREATE INDEX "PlayerBookmark_userId_createdAt_idx" ON "PlayerBookmark"("userId", "createdAt");
CREATE INDEX "PlayerBookmark_worldId_resourceKind_resourceId_idx" ON "PlayerBookmark"("worldId", "resourceKind", "resourceId");
