-- CreateTable
CREATE TABLE "MapElement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "layerId" TEXT,
    "kind" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "style" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MapElement_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MapElement_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "MapLayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MapElement_mapId_idx" ON "MapElement"("mapId");