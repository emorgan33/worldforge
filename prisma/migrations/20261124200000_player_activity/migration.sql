-- Player activity feed: one row per shared article or published map.
CREATE TABLE "PlayerActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worldId" TEXT NOT NULL,
    "resourceKind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerActivity_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlayerActivity_resourceKind_resourceId_key" ON "PlayerActivity"("resourceKind", "resourceId");
CREATE INDEX "PlayerActivity_worldId_occurredAt_idx" ON "PlayerActivity"("worldId", "occurredAt");
CREATE INDEX "PlayerActivity_occurredAt_idx" ON "PlayerActivity"("occurredAt");
