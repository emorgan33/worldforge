-- Private player notebook notes. Notes survive world deletion; campaign and
-- resource references are re-checked at read time.
CREATE TABLE "PlayerNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "worldId" TEXT,
    "resourceKind" TEXT,
    "resourceId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerNote_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PlayerNote_userId_updatedAt_idx" ON "PlayerNote"("userId", "updatedAt");
CREATE INDEX "PlayerNote_worldId_resourceKind_resourceId_idx" ON "PlayerNote"("worldId", "resourceKind", "resourceId");
