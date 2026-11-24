-- Player-safe map publications. A snapshot holds the GM's explicit selection
-- of layers, pins and annotations; readers never receive the editable map.
CREATE TABLE "MapPublication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    CONSTRAINT "MapPublication_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MapPublication_mapId_key" ON "MapPublication"("mapId");
